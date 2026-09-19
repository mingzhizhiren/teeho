import { VIDEO_RULES } from '../config/constants'
import type { VideoRuntimeDescriptor } from './video.runtime'

/** 视频资产生命周期状态。 */
export type VideoAssetState =
    | 'awaiting_upload'
    | 'uploaded'
    | 'queued'
    | 'processing'
    | 'ready'
    | 'deterministic_failed'
    | 'technical_failed'
    | 'cancelled'
    | 'expired'
    | 'deleting'
    | 'deleted'
    | 'cleanup_failed'

/** 允许上传的视频媒体类型。 */
export type VideoMediaType = 'video/mp4' | 'video/quicktime'

/** 视频资产记录。 */
export interface VideoAssetRecord {
    id: string
    userId: string
    uploadSessionId: string
    state: VideoAssetState
    fileName: string
    declaredMediaType: VideoMediaType
    declaredByteSize: number
    originalObjectPath: string
    uploadExpiresAt: string
    processingAttemptCount: number
    failureCode: string | null
    evidenceId: string | null
    queuePosition: number | null
    createdAt: string
    updatedAt: string
}

/** 创建视频上传资格的参数。 */
export interface CreateVideoUploadParam {
    sessionId: string
    videoId: string
    userId: string
    fileName: string
    declaredMediaType: VideoMediaType
    declaredByteSize: number
    originalObjectPath: string
    uploadExpiresAt: string
}

/** 服务端复核后的视频对象信息。 */
export interface VerifiedVideoObject {
    byteSize: number
    mediaType: VideoMediaType
}

/** 视频上传与用户操作的持久化边界。 */
export interface VideoPersistence {
    createUpload(param: CreateVideoUploadParam, policy: VideoAdmissionPolicy): Promise<void>
    findOwned(userId: string, videoId: string): Promise<VideoAssetRecord | null>
    markQueued(
        userId: string,
        videoId: string,
        object: VerifiedVideoObject,
    ): Promise<VideoAssetRecord | null>
    cancelOwned(userId: string, videoId: string): Promise<VideoAssetRecord | null>
}

/** 视频上传准入策略。 */
export interface VideoAdmissionPolicy {
    pointsEnabled: boolean
    minimumAvailablePoints: number
    maximumConcurrentPerAccount: number
    maximumStartsPerWindow: number
    startWindowMs: number
    workerHealthyWithinMs: number
    maximumWaitingPerHealthyWorker: number
}

/** 视频上传准入拒绝原因。 */
export type VideoAdmissionRejection =
    | 'worker_unavailable'
    | 'global_capacity_reached'
    | 'account_busy'
    | 'start_rate_limited'
    | 'subscription_required'
    | 'insufficient_points'

/** 可用于分析的就绪视频证据帧。 */
export interface ReadyVideoEvidenceFrame {
    timestampMs: number
    selectionReason: string
    objectPath: string
    sha256: string
    width: number
    height: number
    byteSize: number
    mediaType: 'image/webp'
}

/** Worker 提交的就绪视频证据包。 */
export interface ReadyVideoEvidence {
    id: string
    evidenceVersion: string
    originalSha256: string
    durationMs: number
    width: number
    height: number
    container: string
    videoCodec: string
    hasAudio: boolean
    mediaMetadata: Record<string, unknown>
    pipelineVersion: string
    pipelineConfigVersion: string
    ffmpegVersion: string
    manifestObjectPath: string
    generatedAt: string
    expiresAt: string
    frames: ReadyVideoEvidenceFrame[]
}

/** 分析流程可读取的已就绪证据；不包含原视频或对象存储凭据。 */
export interface ReadyVideoAnalysisEvidence {
    assetId: string
    evidenceId: string
    evidenceVersion: typeof VIDEO_RULES.evidenceVersion
    originalSha256: string
    durationMs: number
    width: number
    height: number
    container: string
    videoCodec: string
    hasAudio: boolean
    mediaMetadata: Record<string, unknown>
    expiresAt: string
    frames: ReadyVideoEvidenceFrame[]
}

/** 视频 Worker 状态持久化边界。 */
export interface VideoWorkerPersistence {
    registerWorker(workerId: string, runtime: VideoRuntimeDescriptor): Promise<void>
    heartbeatWorker(workerId: string): Promise<void>
    stopWorker(workerId: string): Promise<void>
    recoverExpiredLeases(): Promise<number>
    heartbeatLease(workerId: string, assetId: string, leaseMs: number): Promise<boolean>
    claimNext(workerId: string, leaseMs: number): Promise<VideoAssetRecord | null>
    markReady(assetId: string, workerId: string, evidence: ReadyVideoEvidence): Promise<boolean>
    markFailed(
        assetId: string,
        workerId: string,
        failure: VideoProcessingFailure,
    ): Promise<VideoFailureOutcome>
    claimOriginalCleanup(
        workerId: string,
        leaseMs: number,
        assetId?: string,
    ): Promise<VideoOriginalCleanupRecord | null>
    completeOriginalCleanup(assetId: string, workerId: string): Promise<boolean>
    failOriginalCleanup(assetId: string, workerId: string, code: string): Promise<boolean>
    claimEvidenceCleanup(
        workerId: string,
        leaseMs: number,
    ): Promise<VideoEvidenceCleanupRecord | null>
    completeEvidenceCleanup(evidenceId: string, workerId: string): Promise<boolean>
    failEvidenceCleanup(evidenceId: string, workerId: string, code: string): Promise<boolean>
}

/** 视频预处理失败分类。 */
export interface VideoProcessingFailure {
    kind: 'deterministic' | 'technical'
    code: string
}

/** 视频预处理失败后的状态推进结果。 */
export type VideoFailureOutcome = 'retry_scheduled' | 'terminal' | 'stale'

/** 待清理的原视频对象记录。 */
export interface VideoOriginalCleanupRecord {
    assetId: string
    originalObjectPath: string
}

/** 待清理的视频证据对象记录。 */
export interface VideoEvidenceCleanupRecord {
    evidenceId: string
    objectPaths: string[]
}
