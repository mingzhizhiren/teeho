import { TIME_MS } from '../../config/constants'
import { withTransaction } from '../../db/database'
import { analysisTaskConfig } from '../analysis.config'
import { analysisMediaConstraints } from '../analysis.constants'
import { AnalysisAssetExpiredError } from '../analysis.errors'
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
import {
    createAnalysisMediaPreviewUrl,
    supabaseAnalysisObjectStorage,
    type AnalysisObjectStorage,
} from './analysis.storage'

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

/** 账号不可见的素材与不存在的素材使用同一领域错误。 */
export class AnalysisMediaAssetNotFoundError extends Error {
    constructor() {
        super('图片素材不存在')
        this.name = 'AnalysisMediaAssetNotFoundError'
    }
}

/** 预览限制独立于上传窗口，达到限制不清空草稿或素材。 */
export class AnalysisMediaPreviewRateLimitError extends Error {
    constructor(readonly retryAfterSeconds: number) {
        super('图片预览请求过于频繁，请稍后重试')
        this.name = 'AnalysisMediaPreviewRateLimitError'
    }
}

export interface CreateAnalysisMediaServiceOptions {
    storage?: AnalysisObjectStorage
    persistence?: AnalysisMediaPersistence
    clock?: AnalysisMediaClock
    signPreview?: (path: string, seconds: number) => Promise<string>
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
        declaredMediaType: asset.declaredMediaType,
        declaredByteSize: asset.declaredByteSize,
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
    const signPreview = options.signPreview ?? createAnalysisMediaPreviewUrl
    let previewWindows = new Map<string, { expiresAt: number; count: number }>()
    function claimPreview(userId: string): void {
        const now = clock.now().getTime()
        const previous = previewWindows.get(userId)
        const current =
            previous && previous.expiresAt > now
                ? previous
                : { expiresAt: now + TIME_MS.MINUTE, count: 0 }
        if (current.count >= analysisMediaConstraints.previewRequestsPerMinute) {
            throw new AnalysisMediaPreviewRateLimitError(
                Math.ceil((current.expiresAt - now) / TIME_MS.SECOND),
            )
        }
        previewWindows = new Map([
            ...[...previewWindows].filter(
                ([id, window]) => id !== userId && window.expiresAt > now,
            ),
            [userId, { ...current, count: current.count + 1 }],
        ])
    }

    const getStatuses = async (userId: string, assetIds: string[]) => {
        const uniqueIds = [...new Set(assetIds)]
        if (await persistence.hasCleanupRequested(userId, uniqueIds)) {
            throw new AnalysisMediaUploadRateLimitError()
        }
        const assets = await persistence.findOwned(userId, uniqueIds)
        const byId = new Map(assets.map((asset) => [asset.id, asset]))
        if (byId.size !== uniqueIds.length) {
            throw new AnalysisMediaAssetNotFoundError()
        }
        return uniqueIds.map((id) => publicAsset(byId.get(id)!))
    }

    return {
        /** 预览只引用有效派生图，签名期限不能越过资产期限。 */
        async getPreview(userId: string, assetId: string) {
            claimPreview(userId)
            const [asset] = await persistence.findOwned(userId, [assetId])
            const hasCleanupRequested = await persistence.hasCleanupRequested(userId, [assetId])
            const now = clock.now().getTime()
            const remaining = asset
                ? Math.floor((Date.parse(asset.expiresAt) - now) / TIME_MS.SECOND) -
                  analysisMediaConstraints.previewSigningSafetySeconds
                : 0
            if (
                !asset ||
                asset.state !== 'ready' ||
                !asset.processedObjectPath ||
                !Number.isFinite(remaining) ||
                remaining <= 0 ||
                hasCleanupRequested
            ) {
                throw new AnalysisAssetExpiredError('图片已不可用，请重新上传')
            }
            const seconds = Math.min(remaining, analysisMediaConstraints.previewMaxAgeSeconds)
            const previewUrl = await signPreview(asset.processedObjectPath, seconds)
            if (await persistence.hasCleanupRequested(userId, [assetId])) {
                throw new AnalysisAssetExpiredError('图片已不可用，请重新上传')
            }
            const signedAt = clock.now().getTime()
            if (signedAt >= Date.parse(asset.expiresAt)) {
                throw new AnalysisAssetExpiredError('图片已不可用，请重新上传')
            }
            if (
                signedAt >= now + seconds * TIME_MS.SECOND ||
                signedAt + seconds * TIME_MS.SECOND > Date.parse(asset.expiresAt)
            ) {
                // Storage 按实际签发时刻起算；用响应时刻保守核验，超时资格不得交给浏览器。
                throw new Error('图片预览暂不可用，请重试')
            }
            return {
                assetId,
                previewUrl,
                previewExpiresAt: new Date(now + seconds * TIME_MS.SECOND).toISOString(),
            }
        },
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
