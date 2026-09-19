import type { AnalysisMediaAsset, AnalysisMediaUploadSession } from './analysis.contract'
import { analysisUiConstraints } from './analysis.constants'
import { isAnalysisMediaUploadRateLimitError } from './analysis.media-upload-rate'
import type { SharedTaskImage } from './taskDraft'

export interface AnalysisMediaUploadDescriptor {
    fileName: string
    declaredMediaType: 'image/jpeg' | 'image/png' | 'image/webp'
    byteSize: number
}

export interface AnalysisMediaTransport {
    createSession: (files: AnalysisMediaUploadDescriptor[]) => Promise<AnalysisMediaUploadSession>
    directUpload: (
        uploadUrl: string,
        file: File,
        onProgress: (percentage: number) => void,
    ) => Promise<void>
    confirm: (assetId: string) => Promise<unknown>
    statuses: (assetIds: string[]) => Promise<AnalysisMediaAsset[]>
    retry: (assetId: string) => Promise<unknown>
}

/** 汇报单张草稿图片的直传进度。 */
export type AnalysisImageUploadProgress = (localId: string, percentage: number) => void

function draftImageFileIdentity(file: File) {
    return `${file.name}:${file.size}:${file.lastModified}`
}

/** 保留现有集合成员，只把真正新增或发生变化的文件交给上传与预处理。 */
export function selectNewDraftImageFiles(existing: File[], selected: File[]) {
    const identities = new Set(existing.map(draftImageFileIdentity))
    return selected.filter((file) => {
        const identity = draftImageFileIdentity(file)
        if (identities.has(identity)) return false
        identities.add(identity)
        return true
    })
}

/** 创建立即可展示本地缩略图的上传中草稿图片。 */
export function createUploadingDraftImage(file: File, localId = crypto.randomUUID()) {
    return {
        localId,
        file,
        assetId: null,
        status: 'uploading',
        uploadProgress: analysisUiConstraints.percentageMinimum,
        contentHash: null,
        errorCode: null,
        failureStage: null,
    } satisfies SharedTaskImage
}

function uploadFailure(image: SharedTaskImage): SharedTaskImage {
    return {
        ...image,
        status: 'failed',
        contentHash: null,
        errorCode: 'upload_failed',
        failureStage: 'upload',
    }
}

/** 一批图片共用一次元数据资格，然后各自直传并确认进入处理队列。 */
export async function uploadDraftImages(
    images: SharedTaskImage[],
    transport: AnalysisMediaTransport,
    onProgress: AnalysisImageUploadProgress = () => undefined,
) {
    if (images.length === 0) {
        return []
    }
    let session: AnalysisMediaUploadSession
    try {
        session = await transport.createSession(
            images.map((image) => ({
                fileName: image.file.name,
                declaredMediaType: image.file
                    .type as AnalysisMediaUploadDescriptor['declaredMediaType'],
                byteSize: image.file.size,
            })),
        )
    } catch (error) {
        if (isAnalysisMediaUploadRateLimitError(error)) throw error
        return images.map(uploadFailure)
    }
    if (session.assets.length !== images.length) {
        return images.map(uploadFailure)
    }
    return Promise.all(
        images.map(async (image, index): Promise<SharedTaskImage> => {
            const qualification = session.assets[index]!
            const qualified = { ...image, assetId: qualification.id }
            try {
                await transport.directUpload(qualification.uploadUrl, image.file, (percentage) =>
                    onProgress(image.localId, percentage),
                )
                await transport.confirm(qualification.id)
                return {
                    ...qualified,
                    status: 'processing',
                    uploadProgress: analysisUiConstraints.percentageComplete,
                    errorCode: null,
                    failureStage: null,
                }
            } catch {
                return uploadFailure(qualified)
            }
        }),
    )
}

function applyRemoteStatus(image: SharedTaskImage, asset: AnalysisMediaAsset): SharedTaskImage {
    if (asset.state === 'ready' && asset.contentHash) {
        return {
            ...image,
            status: 'ready',
            contentHash: asset.contentHash,
            errorCode: null,
            failureStage: null,
        }
    }
    if (['awaiting_upload', 'uploaded', 'processing'].includes(asset.state)) {
        return {
            ...image,
            status: 'processing',
            contentHash: null,
            errorCode: null,
            failureStage: null,
        }
    }
    return {
        ...image,
        status: 'failed',
        contentHash: null,
        errorCode: asset.errorCode ?? 'image_processing_failed',
        failureStage: 'processing',
    }
}

/** 执行一次非持久任务状态刷新；调用方只在存在 processing 图片时短轮询。 */
export async function refreshDraftImageStatuses(
    images: SharedTaskImage[],
    transport: AnalysisMediaTransport,
) {
    const pendingIds = images.flatMap((image) =>
        image.status === 'processing' && image.assetId ? [image.assetId] : [],
    )
    if (pendingIds.length === 0) {
        return images
    }
    const assets = await transport.statuses(pendingIds)
    const byId = new Map(assets.map((asset) => [asset.id, asset]))
    return images.map((image) => {
        if (!image.assetId || image.status !== 'processing') {
            return image
        }
        const asset = byId.get(image.assetId)
        return asset ? applyRemoteStatus(image, asset) : image
    })
}

/** 处理失败复用既有素材；上传失败重新申请一次性资格。 */
export async function retryDraftImage(image: SharedTaskImage, transport: AnalysisMediaTransport) {
    if (image.failureStage === 'processing' && image.assetId) {
        await transport.retry(image.assetId)
        return {
            ...image,
            status: 'processing',
            errorCode: null,
            failureStage: null,
        } satisfies SharedTaskImage
    }
    const [retried] = await uploadDraftImages(
        [
            {
                ...image,
                assetId: null,
                status: 'uploading',
                uploadProgress: analysisUiConstraints.percentageMinimum,
                contentHash: null,
                errorCode: null,
                failureStage: null,
            },
        ],
        transport,
    )
    return retried!
}
