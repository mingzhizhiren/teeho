import { ApiRequestError } from '@/utils/apiRequestError'

interface MediaUploadRateLimitData {
    readonly reason: 'analysis_media_upload_rate'
    readonly clearDraftMedia: true
}

/** 识别服务端已经作废共享草稿素材的结构化 429。 */
export function isAnalysisMediaUploadRateLimitError(
    error: unknown,
): error is ApiRequestError & { readonly data: MediaUploadRateLimitData } {
    if (!(error instanceof ApiRequestError)) return false
    const data = error.data
    return (
        typeof data === 'object' &&
        data !== null &&
        'reason' in data &&
        data.reason === 'analysis_media_upload_rate' &&
        'clearDraftMedia' in data &&
        data.clearDraftMedia === true
    )
}
