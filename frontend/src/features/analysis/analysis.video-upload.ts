import type { AnalysisVideo, AnalysisVideoUploadSession } from './analysis.contract'
import { ApiRequestError } from '@/utils/apiRequestError'
import { isAnalysisMediaUploadRateLimitError } from './analysis.media-upload-rate'
import type { SharedTaskVideo } from './taskDraft'

const completeUploadPercentage = 100
const unavailableRestoredVideoStates: ReadonlyArray<AnalysisVideo['state']> = [
    'cancelled',
    'expired',
    'deleting',
    'deleted',
    'cleanup_failed',
]

/** 视频直传凭据、对象路径与到期时间。 */
export interface AnalysisVideoUploadDescriptor {
    fileName: string
    declaredMediaType: 'video/mp4' | 'video/quicktime'
    byteSize: number
}

/** 视频上传前的资格校验结果。 */
export type AnalysisVideoUploadQualification = AnalysisVideoUploadSession['video']['upload']

/** 可替换的视频上传传输边界。 */
export interface AnalysisVideoTransport {
    createSession(file: AnalysisVideoUploadDescriptor): Promise<AnalysisVideoUploadSession>
    resumeSession(videoId: string): Promise<AnalysisVideoUploadSession>
    directUpload(
        qualification: AnalysisVideoUploadQualification,
        file: File,
        onProgress: (percentage: number) => void,
        signal: AbortSignal,
    ): Promise<void>
    confirm(videoId: string): Promise<AnalysisVideo>
    status(videoId: string): Promise<AnalysisVideo>
    cancel(videoId: string): Promise<AnalysisVideo>
}

/** 浏览器选择视频时的确定性错误。 */
export type BrowserVideoSelectionError =
    | 'video_select_one'
    | 'video_invalid_type'
    | 'video_extension_mismatch'
    | 'video_file_too_large'

interface BrowserVideoSelectionLimits {
    allowedMediaTypes: ReadonlyArray<'video/mp4' | 'video/quicktime'>
    maxFileBytes: number
}

/** 在申请服务端资格前检查浏览器可确定的一条视频边界。 */
export function validateBrowserVideoSelection(
    files: readonly File[],
    limits: BrowserVideoSelectionLimits,
): BrowserVideoSelectionError | null {
    if (files.length !== 1) {
        return 'video_select_one'
    }
    const file = files[0]!
    const mediaType = file.type as AnalysisVideoUploadDescriptor['declaredMediaType']
    if (!limits.allowedMediaTypes.includes(mediaType)) {
        return 'video_invalid_type'
    }
    const expectedExtension = mediaType === 'video/mp4' ? /\.mp4$/iu : /\.mov$/iu
    if (!expectedExtension.test(file.name)) {
        return 'video_extension_mismatch'
    }
    if (file.size < 1 || file.size > limits.maxFileBytes) {
        return 'video_file_too_large'
    }
    return null
}

/** 创建带真实上传进度的单视频本地草稿。 */
export function createUploadingDraftVideo(file: File, localId = crypto.randomUUID()) {
    return {
        localId,
        file,
        fileName: file.name,
        byteSize: file.size,
        declaredMediaType: file.type as AnalysisVideoUploadDescriptor['declaredMediaType'],
        videoId: null,
        status: 'uploading',
        uploadProgress: 0,
        queuePosition: null,
        evidenceId: null,
        errorCode: null,
        remoteUpdatedAt: null,
    } satisfies SharedTaskVideo
}

/** 只有完全相同的本地文件元数据才允许接续既有 TUS 会话。 */
export function attachDraftVideoFile(video: SharedTaskVideo, file: File) {
    if (
        file.name !== video.fileName ||
        file.size !== video.byteSize ||
        file.type !== video.declaredMediaType
    ) {
        throw new Error('selected_video_does_not_match')
    }
    return { ...video, file, status: 'uploading' as const, errorCode: null }
}

function isOlderOrDuplicateRemoteStatus(video: SharedTaskVideo, remote: AnalysisVideo) {
    if (!video.remoteUpdatedAt) {
        return false
    }
    const currentTime = Date.parse(video.remoteUpdatedAt)
    const incomingTime = Date.parse(remote.updatedAt)
    return Number.isFinite(currentTime) && Number.isFinite(incomingTime)
        ? incomingTime <= currentTime
        : remote.updatedAt <= video.remoteUpdatedAt
}

/** 合并权威 HTTP 状态，并拒绝由并发读取产生的重复或旧响应。 */
export function applyRemoteVideoStatus(
    video: SharedTaskVideo,
    remote: AnalysisVideo,
): SharedTaskVideo {
    if (
        (video.videoId && video.videoId !== remote.id) ||
        isOlderOrDuplicateRemoteStatus(video, remote)
    ) {
        return video
    }
    const common = {
        ...video,
        videoId: remote.id,
        fileName: remote.fileName,
        remoteUpdatedAt: remote.updatedAt,
    }
    if (remote.state === 'awaiting_upload') {
        return {
            ...common,
            status: video.file ? 'uploading' : 'upload_paused',
            queuePosition: null,
            evidenceId: null,
            errorCode: null,
        }
    }
    if (remote.state === 'ready' && remote.evidenceId) {
        return {
            ...common,
            status: 'ready',
            uploadProgress: completeUploadPercentage,
            queuePosition: null,
            evidenceId: remote.evidenceId,
            errorCode: null,
        }
    }
    if (remote.state === 'queued' || remote.state === 'uploaded') {
        return {
            ...common,
            status: 'queued',
            uploadProgress: completeUploadPercentage,
            queuePosition: remote.queuePosition,
            evidenceId: null,
            errorCode: null,
        }
    }
    if (remote.state === 'processing') {
        return {
            ...common,
            status: 'processing',
            uploadProgress: completeUploadPercentage,
            queuePosition: null,
            evidenceId: null,
            errorCode: null,
        }
    }
    return {
        ...common,
        status: 'failed',
        uploadProgress: completeUploadPercentage,
        queuePosition: null,
        evidenceId: null,
        errorCode: remote.errorCode ?? `video_${remote.state}`,
    }
}

function uploadFailureCode(error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
        return 'video_upload_cancelled'
    }
    if (error && typeof error === 'object' && 'data' in error) {
        const data = error.data
        if (data && typeof data === 'object' && 'reason' in data) {
            const reason = data.reason
            if (typeof reason === 'string' && reason) {
                return reason
            }
        }
    }
    return 'video_upload_failed'
}

/** 申请或刷新资格、浏览器 TUS 直传并通知后端进入预处理队列。 */
export async function uploadDraftVideo(
    video: SharedTaskVideo,
    transport: AnalysisVideoTransport,
    onChange: (video: SharedTaskVideo) => void = () => undefined,
    signal: AbortSignal = new AbortController().signal,
) {
    if (!video.file) {
        throw new Error('video_file_not_selected')
    }
    let current = video
    try {
        const session = video.videoId
            ? await transport.resumeSession(video.videoId)
            : await transport.createSession({
                  fileName: video.fileName,
                  declaredMediaType: video.declaredMediaType,
                  byteSize: video.byteSize,
              })
        current = {
            ...video,
            videoId: session.video.id,
            status: 'uploading' as const,
            errorCode: null,
        }
        onChange(current)
        await transport.directUpload(
            session.video.upload,
            video.file,
            (percentage) => {
                current = {
                    ...current,
                    uploadProgress: Math.max(
                        0,
                        Math.min(completeUploadPercentage, Math.round(percentage)),
                    ),
                }
                onChange(current)
            },
            signal,
        )
        if (signal.aborted) {
            throw new DOMException('Upload aborted', 'AbortError')
        }
        current = { ...current, uploadProgress: completeUploadPercentage }
        const queued = applyRemoteVideoStatus(current, await transport.confirm(session.video.id))
        onChange(queued)
        return queued
    } catch (error) {
        if (isAnalysisMediaUploadRateLimitError(error)) throw error
        const failed = {
            ...current,
            status: 'failed',
            errorCode: uploadFailureCode(error),
        } satisfies SharedTaskVideo
        onChange(failed)
        return failed
    }
}

/** 只使用认证后端状态切换排队、处理、就绪或失败，不模拟 FFmpeg 百分比。 */
export async function refreshDraftVideoStatus(
    video: SharedTaskVideo,
    transport: AnalysisVideoTransport,
) {
    if (!video.videoId) {
        return video
    }
    return applyRemoteVideoStatus(video, await transport.status(video.videoId))
}

/** 恢复期间以服务端状态收敛视频；已清理资产直接释放本地草稿槽位。 */
export async function reconcileRestoredDraftVideo(
    video: SharedTaskVideo,
    transport: AnalysisVideoTransport,
): Promise<SharedTaskVideo | null> {
    if (!video.videoId) return video
    try {
        const remote = await transport.status(video.videoId)
        return unavailableRestoredVideoStates.includes(remote.state)
            ? null
            : applyRemoteVideoStatus(video, remote)
    } catch (error: unknown) {
        if (
            error instanceof ApiRequestError &&
            error.data &&
            typeof error.data === 'object' &&
            'reason' in error.data &&
            error.data.reason === 'not_found'
        ) {
            return null
        }
        throw error
    }
}
