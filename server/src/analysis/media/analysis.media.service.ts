import { TIME_MS } from '../../config/constants'
import { withTransaction } from '../../db/database'
import { analysisTaskConfig } from '../analysis.config'
import { analysisMediaConstraints } from '../analysis.constants'
import { requestAnalysisMediaCleanupRunBestEffort } from './analysis.asset-lifecycle.service'
import { validateAnalysisUploadDescriptors, type AnalysisUploadDescriptor } from './analysis.media'
import { AnalysisMediaUploadRateLimitError } from './analysis.media-upload-admission'
import { admitAnalysisMediaUpload } from './analysis.media-upload-admission.repository'
import {
    findOwnedMediaAssets,
    hasMediaAssetCleanupRequested,
    insertMediaUploadSession,
    markMediaAssetUploaded,
    retryMediaAsset,
    type AnalysisMediaAssetRecord,
    type InsertMediaUploadSessionParam,
} from './analysis.media.repository'
import { supabaseAnalysisObjectStorage, type AnalysisObjectStorage } from './analysis.storage'

interface AnalysisMediaPersistence {
    insertSession(param: InsertMediaUploadSessionParam): Promise<void>
    findOwned(userId: string, ids: string[]): Promise<AnalysisMediaAssetRecord[]>
    markUploaded(assetId: string, userId: string): Promise<AnalysisMediaAssetRecord | null>
    retry(assetId: string, userId: string): Promise<boolean>
    hasCleanupRequested(userId: string, ids: string[]): Promise<boolean>
}

interface AnalysisMediaClock {
    now: () => Date
    randomUUID: () => string
}

const postgresAnalysisMediaPersistence: AnalysisMediaPersistence = {
    insertSession: async (param) => {
        const admitted = await withTransaction(async (transaction) => {
            const decision = await admitAnalysisMediaUpload(transaction, param.userId, {
                kind: 'image',
                count: param.assets.length,
            })
            if (!decision.admitted) return false
            await insertMediaUploadSession(transaction, param)
            return true
        })
        if (admitted) return
        requestAnalysisMediaCleanupRunBestEffort()
        throw new AnalysisMediaUploadRateLimitError()
    },
    findOwned: findOwnedMediaAssets,
    markUploaded: markMediaAssetUploaded,
    retry: retryMediaAsset,
    hasCleanupRequested: hasMediaAssetCleanupRequested,
}

const systemAnalysisMediaClock: AnalysisMediaClock = {
    now: () => new Date(),
    randomUUID: () => crypto.randomUUID(),
}

export interface CreateAnalysisMediaServiceOptions {
    storage?: AnalysisObjectStorage
    persistence?: AnalysisMediaPersistence
    clock?: AnalysisMediaClock
}

function extensionFor(mediaType: AnalysisMediaAssetRecord['declaredMediaType']) {
    if (mediaType === 'image/jpeg') {
        return 'jpg'
    }
    return mediaType === 'image/png' ? 'png' : 'webp'
}

function publicAsset(asset: AnalysisMediaAssetRecord) {
    return {
        id: asset.id,
        fileName: asset.fileName,
        state: asset.state,
        mediaType: asset.mediaType,
        byteSize: asset.byteSize,
        width: asset.width,
        height: asset.height,
        contentHash: asset.sha256,
        errorCode: asset.failureCode,
        expiresAt: asset.expiresAt,
    }
}

/** 创建统一的私有图片上传、确认、状态与重试服务。 */
export function createAnalysisMediaService(options: CreateAnalysisMediaServiceOptions = {}) {
    const storage = options.storage ?? supabaseAnalysisObjectStorage
    const persistence = options.persistence ?? postgresAnalysisMediaPersistence
    const clock = options.clock ?? systemAnalysisMediaClock

    const getStatuses = async (userId: string, assetIds: string[]) => {
        const uniqueIds = [...new Set(assetIds)]
        if (await persistence.hasCleanupRequested(userId, uniqueIds)) {
            throw new AnalysisMediaUploadRateLimitError()
        }
        const assets = await persistence.findOwned(userId, uniqueIds)
        const byId = new Map(assets.map((asset) => [asset.id, asset]))
        if (byId.size !== uniqueIds.length) {
            throw new Error('图片素材不存在')
        }
        return uniqueIds.map((id) => publicAsset(byId.get(id)!))
    }

    return {
        async createUploadSession(userId: string, files: AnalysisUploadDescriptor[]) {
            const totalBytes = validateAnalysisUploadDescriptors(files)
            const now = clock.now()
            const sessionId = clock.randomUUID()
            const uploadExpiresAt = new Date(
                now.getTime() +
                    analysisMediaConstraints.signedUploadLifetimeSeconds * TIME_MS.SECOND,
            ).toISOString()
            const assetExpiresAt = new Date(
                now.getTime() + analysisTaskConfig.uploads.retentionSeconds * TIME_MS.SECOND,
            ).toISOString()
            const assets = files.map((file, position) => {
                const id = clock.randomUUID()
                return {
                    id,
                    position,
                    fileName: file.fileName,
                    declaredMediaType:
                        file.declaredMediaType as AnalysisMediaAssetRecord['declaredMediaType'],
                    declaredByteSize: file.byteSize,
                    originalObjectPath: `${userId}/${sessionId}/original/${id}.${extensionFor(
                        file.declaredMediaType as AnalysisMediaAssetRecord['declaredMediaType'],
                    )}`,
                }
            })
            await persistence.insertSession({
                sessionId,
                userId,
                totalBytes,
                uploadExpiresAt,
                assetExpiresAt,
                assets,
            })
            const qualifications = await Promise.all(
                assets.map(async (asset) => {
                    const qualification = await storage.createSignedUpload(asset.originalObjectPath)
                    return {
                        id: asset.id,
                        fileName: asset.fileName,
                        state: 'awaiting_upload' as const,
                        uploadExpiresAt,
                        uploadUrl: qualification.signedUrl,
                        uploadToken: qualification.token,
                    }
                }),
            )
            return { sessionId, assets: qualifications }
        },

        async confirmUpload(userId: string, assetId: string) {
            if (await persistence.hasCleanupRequested(userId, [assetId])) {
                throw new AnalysisMediaUploadRateLimitError()
            }
            const [asset] = await persistence.findOwned(userId, [assetId])
            if (!asset) {
                throw new Error('图片素材不存在')
            }
            const object = await storage.info(asset.originalObjectPath)
            if (!object) {
                throw new Error('上传对象不存在')
            }
            if (
                (object.size !== null && object.size !== asset.declaredByteSize) ||
                (object.contentType !== null && object.contentType !== asset.declaredMediaType)
            ) {
                throw new Error('上传对象与申请信息不一致')
            }
            const uploaded = await persistence.markUploaded(assetId, userId)
            if (!uploaded) {
                if (await persistence.hasCleanupRequested(userId, [assetId])) {
                    throw new AnalysisMediaUploadRateLimitError()
                }
                throw new Error('图片上传资格已过期或状态无效')
            }
            return publicAsset(uploaded)
        },

        getStatuses,

        async retry(userId: string, assetId: string) {
            if (await persistence.hasCleanupRequested(userId, [assetId])) {
                throw new AnalysisMediaUploadRateLimitError()
            }
            if (!(await persistence.retry(assetId, userId))) {
                throw new Error('图片无法重试')
            }
            return getStatuses(userId, [assetId]).then(([asset]) => asset!)
        },
    }
}

/** 生产图片服务实例。 */
export const analysisMediaService = createAnalysisMediaService()
