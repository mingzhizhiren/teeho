import { z } from 'zod'

import { API_CODES, HTTP_STATUS, VIDEO_RULES } from '../config/constants'
import { fail, ok } from '../utils/response'
import { VideoEvidenceTransferError, videoEvidenceTransferService } from './video.evidence-transfer'
import { VideoServiceError, videoService } from './video.service'
import { AnalysisMediaUploadRateLimitError } from '../analysis/media/analysis.media-upload-admission'

const videoIdSchema = z.string().uuid()
const restoreSessionIdSchema = z.string().uuid()
const restoreEvidenceBodySchema = z.object({ manifest: z.unknown() }).strict()
const createVideoUploadBodySchema = z
    .object({
        file: z
            .object({
                fileName: z.string().trim().min(1).max(VIDEO_RULES.originalFileNameMaxLength),
                declaredMediaType: z.enum(VIDEO_RULES.allowedMediaTypes),
                byteSize: z.number().int().positive().max(VIDEO_RULES.maximumUploadBytes),
            })
            .strict(),
    })
    .strict()

const videoErrorReasons: Record<VideoServiceError['code'], string> = {
    VIDEO_INVALID_FILE: 'invalid_file',
    VIDEO_NOT_FOUND: 'not_found',
    VIDEO_UPLOAD_MISMATCH: 'upload_mismatch',
    VIDEO_UPLOAD_EXPIRED: 'upload_expired',
    VIDEO_UPLOAD_NOT_RESUMABLE: 'upload_not_resumable',
    VIDEO_DISABLED: 'video_disabled',
    VIDEO_WORKER_UNAVAILABLE: 'worker_unavailable',
    VIDEO_CAPACITY_REACHED: 'capacity_reached',
    VIDEO_ACCOUNT_BUSY: 'account_busy',
    VIDEO_RATE_LIMITED: 'rate_limited',
    VIDEO_SUBSCRIPTION_REQUIRED: 'subscription_required',
    VIDEO_POINTS_INSUFFICIENT: 'insufficient_points',
}

function videoFailure(error: VideoServiceError, code: number) {
    return fail(code, error.message, { reason: videoErrorReasons[error.code] })
}

function videoErrorResponse(error: unknown) {
    if (error instanceof AnalysisMediaUploadRateLimitError) {
        return {
            status: HTTP_STATUS.TOO_MANY_REQUESTS,
            response: fail(API_CODES.RATE_LIMITED, error.message, {
                reason: 'analysis_media_upload_rate',
                clearDraftMedia: true,
            }),
        }
    }
    if (!(error instanceof VideoServiceError)) {
        throw error
    }
    if (error.code === 'VIDEO_NOT_FOUND') {
        return {
            status: HTTP_STATUS.NOT_FOUND,
            response: videoFailure(error, API_CODES.NOT_FOUND),
        }
    }
    if (error.code === 'VIDEO_UPLOAD_EXPIRED') {
        return {
            status: HTTP_STATUS.GONE,
            response: videoFailure(error, API_CODES.CONFLICT),
        }
    }
    if (
        error.code === 'VIDEO_DISABLED' ||
        error.code === 'VIDEO_WORKER_UNAVAILABLE' ||
        error.code === 'VIDEO_CAPACITY_REACHED'
    ) {
        return {
            status: HTTP_STATUS.SERVICE_UNAVAILABLE,
            response: videoFailure(error, API_CODES.INTERNAL_ERROR),
        }
    }
    if (error.code === 'VIDEO_ACCOUNT_BUSY') {
        return {
            status: HTTP_STATUS.CONFLICT,
            response: videoFailure(error, API_CODES.CONFLICT),
        }
    }
    if (error.code === 'VIDEO_RATE_LIMITED') {
        return {
            status: HTTP_STATUS.TOO_MANY_REQUESTS,
            response: videoFailure(error, API_CODES.RATE_LIMITED),
        }
    }
    if (
        error.code === 'VIDEO_SUBSCRIPTION_REQUIRED' ||
        error.code === 'VIDEO_POINTS_INSUFFICIENT'
    ) {
        return {
            status: HTTP_STATUS.FORBIDDEN,
            response: videoFailure(error, API_CODES.FORBIDDEN),
        }
    }
    return {
        status: HTTP_STATUS.BAD_REQUEST,
        response: videoFailure(error, API_CODES.VALIDATION_ERROR),
    }
}

const evidenceTransferReasons: Record<VideoEvidenceTransferError['code'], string> = {
    VIDEO_EVIDENCE_DOWNLOAD_UNAVAILABLE: 'video_evidence_download_unavailable',
    VIDEO_EVIDENCE_NOT_FOUND: 'evidence_not_found',
    VIDEO_EVIDENCE_EXPIRED: 'evidence_expired',
    VIDEO_EVIDENCE_NOT_EXPIRED: 'evidence_not_expired',
    VIDEO_EVIDENCE_RESTORE_PENDING: 'evidence_restore_pending',
    VIDEO_EVIDENCE_VERSION_UNSUPPORTED: 'evidence_version_unsupported',
    VIDEO_EVIDENCE_RESTORE_INVALID: 'evidence_restore_invalid',
    VIDEO_EVIDENCE_RESTORE_EXPIRED: 'evidence_restore_expired',
}

function evidenceTransferErrorResponse(error: unknown) {
    if (!(error instanceof VideoEvidenceTransferError)) {
        throw error
    }
    if (error.code === 'VIDEO_EVIDENCE_DOWNLOAD_UNAVAILABLE') {
        return {
            status: HTTP_STATUS.SERVICE_UNAVAILABLE,
            response: fail(API_CODES.CONFLICT, error.message, {
                reason: evidenceTransferReasons[error.code],
            }),
        }
    }
    const response = fail(API_CODES.CONFLICT, error.message, {
        reason: evidenceTransferReasons[error.code],
    })
    if (error.code === 'VIDEO_EVIDENCE_NOT_FOUND') {
        return { status: HTTP_STATUS.NOT_FOUND, response }
    }
    if (
        error.code === 'VIDEO_EVIDENCE_EXPIRED' ||
        error.code === 'VIDEO_EVIDENCE_RESTORE_EXPIRED'
    ) {
        return { status: HTTP_STATUS.GONE, response }
    }
    if (error.code === 'VIDEO_EVIDENCE_RESTORE_INVALID') {
        return {
            status: HTTP_STATUS.BAD_REQUEST,
            response: fail(API_CODES.VALIDATION_ERROR, error.message, {
                reason: evidenceTransferReasons[error.code],
            }),
        }
    }
    return { status: HTTP_STATUS.CONFLICT, response }
}

/** 签发单个视频的浏览器 TUS 直传资格。 */
export async function handleCreateVideoUploadSession(userId: string, body: unknown) {
    const parsed = createVideoUploadBodySchema.safeParse(body)
    if (!parsed.success) {
        return {
            status: HTTP_STATUS.BAD_REQUEST,
            response: fail(API_CODES.VALIDATION_ERROR, '视频上传信息无效'),
        }
    }
    try {
        const session = await videoService.createUploadSession(userId, parsed.data.file)
        return {
            status: HTTP_STATUS.CREATED,
            response: ok({ session }),
        }
    } catch (error) {
        return videoErrorResponse(error)
    }
}

/** 复核已直传的 Storage 对象，并将视频放入预处理队列。 */
export async function handleConfirmVideoUpload(userId: string, videoId: unknown) {
    const parsed = videoIdSchema.safeParse(videoId)
    if (!parsed.success) {
        return {
            status: HTTP_STATUS.BAD_REQUEST,
            response: fail(API_CODES.VALIDATION_ERROR, '视频标识无效'),
        }
    }
    try {
        const video = await videoService.confirmUpload(userId, parsed.data)
        return {
            status: HTTP_STATUS.ACCEPTED,
            response: ok({ video }),
        }
    } catch (error) {
        return videoErrorResponse(error)
    }
}

/** 为刷新后重新选择的同一文件签发新的短期 TUS 续传凭据。 */
export async function handleResumeVideoUpload(userId: string, videoId: unknown) {
    const parsed = videoIdSchema.safeParse(videoId)
    if (!parsed.success) {
        return {
            status: HTTP_STATUS.BAD_REQUEST,
            response: fail(API_CODES.VALIDATION_ERROR, '视频标识无效'),
        }
    }
    try {
        const session = await videoService.resumeUpload(userId, parsed.data)
        return {
            status: HTTP_STATUS.OK,
            response: ok({ session }),
        }
    } catch (error) {
        return videoErrorResponse(error)
    }
}

/** 返回认证账号可见的视频预处理状态投影。 */
export async function handleGetVideoStatus(userId: string, videoId: unknown) {
    const parsed = videoIdSchema.safeParse(videoId)
    if (!parsed.success) {
        return {
            status: HTTP_STATUS.BAD_REQUEST,
            response: fail(API_CODES.VALIDATION_ERROR, '视频标识无效'),
        }
    }
    try {
        const video = await videoService.getStatus(userId, parsed.data)
        return {
            status: HTTP_STATUS.OK,
            response: ok({ video }),
        }
    } catch (error) {
        return videoErrorResponse(error)
    }
}

/** 用户删除或替换草稿视频时取消处理并进入幂等清理。 */
export async function handleCancelVideo(userId: string, videoId: unknown) {
    const parsed = videoIdSchema.safeParse(videoId)
    if (!parsed.success) {
        return {
            status: HTTP_STATUS.BAD_REQUEST,
            response: fail(API_CODES.VALIDATION_ERROR, '视频标识无效'),
        }
    }
    try {
        const video = await videoService.cancel(userId, parsed.data)
        return {
            status: HTTP_STATUS.OK,
            response: ok({ video }),
        }
    } catch (error) {
        return videoErrorResponse(error)
    }
}

/** 返回认证账号仍在云端保留期内的证据清单和关键帧下载资格。 */
export async function handleGetVideoEvidence(userId: string, videoId: unknown) {
    const parsed = videoIdSchema.safeParse(videoId)
    if (!parsed.success) {
        return {
            status: HTTP_STATUS.BAD_REQUEST,
            response: fail(API_CODES.VALIDATION_ERROR, '视频标识无效'),
        }
    }
    try {
        const bundle = await videoEvidenceTransferService.getDownload(userId, parsed.data)
        return { status: HTTP_STATUS.OK, response: ok({ bundle }) }
    } catch (error) {
        return evidenceTransferErrorResponse(error)
    }
}

/** 为当前账号过期且版本匹配的本地证据签发恢复直传资格。 */
export async function handleCreateVideoEvidenceRestoreSession(
    userId: string,
    videoId: unknown,
    body: unknown,
) {
    const parsedVideoId = videoIdSchema.safeParse(videoId)
    const parsedBody = restoreEvidenceBodySchema.safeParse(body)
    if (!parsedVideoId.success || !parsedBody.success) {
        return {
            status: HTTP_STATUS.BAD_REQUEST,
            response: fail(API_CODES.VALIDATION_ERROR, '视频证据恢复信息无效'),
        }
    }
    try {
        const session = await videoEvidenceTransferService.createRestoreSession(
            userId,
            parsedVideoId.data,
            parsedBody.data.manifest,
        )
        return { status: HTTP_STATUS.CREATED, response: ok({ session }) }
    } catch (error) {
        return evidenceTransferErrorResponse(error)
    }
}

/** 确认本地证据已经直传，并由服务端重新校验后恢复可分析状态。 */
export async function handleConfirmVideoEvidenceRestore(
    userId: string,
    videoId: unknown,
    sessionId: unknown,
) {
    const parsedVideoId = videoIdSchema.safeParse(videoId)
    const parsedSessionId = restoreSessionIdSchema.safeParse(sessionId)
    if (!parsedVideoId.success || !parsedSessionId.success) {
        return {
            status: HTTP_STATUS.BAD_REQUEST,
            response: fail(API_CODES.VALIDATION_ERROR, '视频证据恢复标识无效'),
        }
    }
    try {
        const evidence = await videoEvidenceTransferService.confirmRestore(
            userId,
            parsedVideoId.data,
            parsedSessionId.data,
        )
        return { status: HTTP_STATUS.OK, response: ok({ evidence }) }
    } catch (error) {
        return evidenceTransferErrorResponse(error)
    }
}
