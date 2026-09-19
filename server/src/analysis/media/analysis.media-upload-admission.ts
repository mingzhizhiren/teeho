import { TIME_MS } from '../../config/constants'
import { analysisMediaUploadAdmissionRules } from '../analysis.constants'

export interface AnalysisMediaUploadCounts {
    readonly imageCount: number
    readonly videoCount: number
}

export interface AnalysisMediaUploadRequest {
    readonly kind: 'image' | 'video'
    readonly count: number
}

export type AnalysisMediaUploadAdmissionDecision =
    | { readonly admitted: true }
    | {
          readonly admitted: false
          readonly reason: 'image_limit' | 'video_limit'
      }

/** 在数据库账号锁内使用的纯准入判断。 */
export function decideAnalysisMediaUploadAdmission(
    counts: AnalysisMediaUploadCounts,
    request: AnalysisMediaUploadRequest,
): AnalysisMediaUploadAdmissionDecision {
    if (
        request.kind === 'image' &&
        counts.imageCount + request.count > analysisMediaUploadAdmissionRules.maximumImages
    ) {
        return { admitted: false, reason: 'image_limit' }
    }
    if (
        request.kind === 'video' &&
        counts.videoCount + request.count > analysisMediaUploadAdmissionRules.maximumVideos
    ) {
        return { admitted: false, reason: 'video_limit' }
    }
    return { admitted: true }
}

/** 超限清空已经提交；调用方应返回结构化 429 并清空浏览器素材。 */
export class AnalysisMediaUploadRateLimitError extends Error {
    readonly retryAfterSeconds = Math.ceil(
        analysisMediaUploadAdmissionRules.windowMs / TIME_MS.SECOND,
    )

    constructor() {
        super('上传过于频繁，素材已清空，请在 1 分钟后重新上传')
        this.name = 'AnalysisMediaUploadRateLimitError'
    }
}
