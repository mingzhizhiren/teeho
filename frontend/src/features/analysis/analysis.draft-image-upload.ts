import { analysisUiConstraints } from './analysis.constants'
import {
    retryDraftImage,
    uploadDraftImages,
    type AnalysisMediaTransport,
} from './analysis.media-upload'
import { isAnalysisMediaUploadRateLimitError } from './analysis.media-upload-rate'
import type { SharedTaskImage } from './taskDraft'

interface DraftImageUploadOwner {
    read: () => SharedTaskImage[]
    update: (images: SharedTaskImage[]) => void
    rateLimited: () => void
}

/** 上传由共享草稿持有，视图切换不会丢失进度和完成结果。 */
export function createDraftImageUpload(
    owner: DraftImageUploadOwner,
    transport: AnalysisMediaTransport,
) {
    let disposed = false
    function merge(updated: SharedTaskImage[]): void {
        if (disposed) return
        const byId = new Map(updated.map((image) => [image.localId, image]))
        const current = owner.read()
        if (!current.some((image) => byId.has(image.localId))) return
        owner.update(current.map((image) => byId.get(image.localId) ?? image))
    }
    function progress(localId: string, percentage: number): void {
        const image = owner.read().find((item) => item.localId === localId)
        if (!image || image.status !== 'uploading') return
        merge([
            {
                ...image,
                uploadProgress: Math.max(
                    analysisUiConstraints.percentageMinimum,
                    Math.min(analysisUiConstraints.percentageComplete, Math.round(percentage)),
                ),
            },
        ])
    }
    return {
        async upload(images: SharedTaskImage[]): Promise<void> {
            if (disposed) return
            owner.update([...owner.read(), ...images])
            try {
                merge(await uploadDraftImages(images, transport, progress))
            } catch (error) {
                if (!isAnalysisMediaUploadRateLimitError(error)) throw error
                if (
                    !disposed &&
                    owner
                        .read()
                        .some((current) =>
                            images.some((image) => image.localId === current.localId),
                        )
                )
                    owner.rateLimited()
            }
        },
        async retry(image: SharedTaskImage): Promise<void> {
            if (disposed || !owner.read().some((item) => item.localId === image.localId)) return
            merge([
                {
                    ...image,
                    status: image.failureStage === 'processing' ? 'processing' : 'uploading',
                    errorCode: null,
                    failureStage: null,
                },
            ])
            try {
                merge([await retryDraftImage(image, transport)])
            } catch (error) {
                if (isAnalysisMediaUploadRateLimitError(error)) {
                    if (
                        !disposed &&
                        owner.read().some((current) => current.localId === image.localId)
                    )
                        owner.rateLimited()
                    return
                }
                merge([{ ...image, status: 'failed', errorCode: 'retry_failed' }])
            }
        },
        dispose(): void {
            disposed = true
        },
    }
}
