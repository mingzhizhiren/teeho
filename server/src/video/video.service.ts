import { VIDEO_RULES } from '../config/constants'
import { AnalysisMediaUploadRateLimitError } from '../analysis/media/analysis.media-upload-admission'
import { isVideoEnabled } from '../config/deployment'
import { getTaskPolicy } from '../runtime/task-policy'
import { env } from '../config/env'
import { logger } from '../utils/logger'
import { postgresVideoPersistence } from './video.admission.service'
import {
    VideoAdmissionRejectedError,
    type VideoAssetRecord,
    type VideoMediaType,
    type VideoPersistence,
} from './video.repository'
import {
    createVideoTusEndpoint,
    supabaseVideoObjectStorage,
    type VideoObjectStorage,
} from './video.storage'

/** 签发给前端的视频上传描述。 */
export interface VideoUploadDescriptor {
    fileName: string
    declaredMediaType: string
    byteSize: number
}

interface VideoClock {
    now: () => Date
    randomUUID: () => string
}

type VideoServiceLogger = Pick<typeof logger, 'debug' | 'warn'>

/** 视频服务错误。 */
export class VideoServiceError extends Error {
    constructor(
        readonly code:
            | 'VIDEO_INVALID_FILE'
            | 'VIDEO_NOT_FOUND'
            | 'VIDEO_UPLOAD_MISMATCH'
            | 'VIDEO_UPLOAD_EXPIRED'
            | 'VIDEO_UPLOAD_NOT_RESUMABLE'
            | 'VIDEO_DISABLED'
            | 'VIDEO_WORKER_UNAVAILABLE'
            | 'VIDEO_CAPACITY_REACHED'
            | 'VIDEO_ACCOUNT_BUSY'
            | 'VIDEO_RATE_LIMITED'
            | 'VIDEO_SUBSCRIPTION_REQUIRED'
            | 'VIDEO_POINTS_INSUFFICIENT',
        message: string,
    ) {
        super(message)
        this.name = 'VideoServiceError'
    }
}

const systemVideoClock: VideoClock = {
    now: () => new Date(),
    randomUUID: () => crypto.randomUUID(),
}

function extensionFor(mediaType: VideoMediaType) {
    return mediaType === 'video/mp4' ? 'mp4' : 'mov'
}

function validateDescriptor(file: VideoUploadDescriptor): VideoMediaType {
    const mediaType = file.declaredMediaType as VideoMediaType
    if (!VIDEO_RULES.allowedMediaTypes.includes(mediaType)) {
        throw new VideoServiceError('VIDEO_INVALID_FILE', '仅支持 MP4 或 MOV 视频')
    }
    if (
        !Number.isSafeInteger(file.byteSize) ||
        file.byteSize < 1 ||
        file.byteSize > VIDEO_RULES.maximumUploadBytes
    ) {
        throw new VideoServiceError('VIDEO_INVALID_FILE', '视频大小必须在 400 MB 以内')
    }
    const normalizedName = file.fileName.trim()
    if (!normalizedName || normalizedName.length > VIDEO_RULES.originalFileNameMaxLength) {
        throw new VideoServiceError('VIDEO_INVALID_FILE', '视频文件名无效')
    }
    const expectedExtension = mediaType === 'video/mp4' ? /\.mp4$/iu : /\.mov$/iu
    if (!expectedExtension.test(normalizedName)) {
        throw new VideoServiceError('VIDEO_INVALID_FILE', '文件扩展名与视频格式不一致')
    }
    return mediaType
}

function publicVideo(asset: VideoAssetRecord) {
    return {
        id: asset.id,
        fileName: asset.fileName,
        state: asset.state,
        queuePosition: asset.queuePosition,
        processingAttemptCount: asset.processingAttemptCount,
        errorCode: asset.failureCode,
        evidenceId: asset.evidenceId,
        createdAt: asset.createdAt,
        updatedAt: asset.updatedAt,
    }
}

function assertDraftVideoStillValid(asset: VideoAssetRecord) {
    if (asset.state === 'cancelled' && asset.failureCode === 'upload_rate_limited') {
        throw new AnalysisMediaUploadRateLimitError()
    }
}

/** 创建视频服务所需的依赖。 */
export interface CreateVideoServiceOptions {
    storage?: VideoObjectStorage
    persistence?: VideoPersistence
    clock?: VideoClock
    tusEndpoint?: string
    videoEnabled?: boolean
    pointsEnabled?: boolean
    log?: VideoServiceLogger
}

const admissionErrorCodes = {
    worker_unavailable: {
        code: 'VIDEO_WORKER_UNAVAILABLE',
        message: '视频处理服务暂不可用，请稍后重试',
    },
    global_capacity_reached: {
        code: 'VIDEO_CAPACITY_REACHED',
        message: '当前视频处理队列已满，请稍后重试',
    },
    account_busy: {
        code: 'VIDEO_ACCOUNT_BUSY',
        message: '当前账号已有视频正在上传或处理',
    },
    start_rate_limited: {
        code: 'VIDEO_RATE_LIMITED',
        message: '一分钟内视频处理次数已达上限，请稍后重试',
    },
    subscription_required: {
        code: 'VIDEO_SUBSCRIPTION_REQUIRED',
        message: '视频分析需要 Coffee 或 Plus 套餐',
    },
    insufficient_points: {
        code: 'VIDEO_POINTS_INSUFFICIENT',
        message: '当前账号没有足够的分析资源',
    },
} as const

function mapAdmissionError(error: unknown): never {
    if (!(error instanceof VideoAdmissionRejectedError)) {
        throw error
    }
    const mapped = admissionErrorCodes[error.code]
    throw new VideoServiceError(mapped.code, mapped.message)
}

/** 视频资格签发、完成确认和只读状态投影；二进制内容永不经过该服务。 */
export function createVideoService(options: CreateVideoServiceOptions = {}) {
    const storage = options.storage ?? supabaseVideoObjectStorage
    const persistence = options.persistence ?? postgresVideoPersistence
    const clock = options.clock ?? systemVideoClock
    const tusEndpoint = options.tusEndpoint ?? createVideoTusEndpoint(env.SUPABASE_URL)
    const videoEnabled = options.videoEnabled ?? isVideoEnabled()
    const log = options.log ?? logger

    async function cancelAdmission(userId: string, videoId: string) {
        try {
            await persistence.cancelOwned(userId, videoId)
        } catch (error) {
            log.warn(
                {
                    event: 'video_admission_compensation_failed',
                    userId,
                    videoId,
                    stage: 'video_admission_compensation',
                    errorCode: 'video_admission_compensation_failed',
                    errorName: error instanceof Error ? error.name : 'UnknownError',
                },
                '视频上传准入补偿失败',
            )
        }
    }

    async function resumableSession(asset: VideoAssetRecord) {
        const qualification = await storage.createSignedUpload(asset.originalObjectPath)
        log.debug(
            {
                event: 'video_upload_resume_issued',
                correlationId: asset.uploadSessionId,
                assetId: asset.id,
                stage: 'upload_resume',
                state: asset.state,
                declaredMediaType: asset.declaredMediaType,
                declaredByteSize: asset.declaredByteSize,
            },
            '视频续传资格已签发',
        )
        return {
            sessionId: asset.uploadSessionId,
            video: {
                id: asset.id,
                fileName: asset.fileName,
                state: 'awaiting_upload' as const,
                upload: {
                    endpoint: tusEndpoint,
                    signature: qualification.signature,
                    bucketName: VIDEO_RULES.storageBucket,
                    objectName: asset.originalObjectPath,
                    expiresAt: asset.uploadExpiresAt,
                },
            },
        }
    }

    return {
        async createUploadSession(userId: string, file: VideoUploadDescriptor) {
            if (!videoEnabled) {
                throw new VideoServiceError('VIDEO_DISABLED', '视频分析功能当前未开放')
            }
            const declaredMediaType = validateDescriptor(file)
            const now = clock.now()
            const sessionId = clock.randomUUID()
            const videoId = clock.randomUUID()
            const uploadExpiresAt = new Date(
                now.getTime() + VIDEO_RULES.signedUploadLifetimeMs,
            ).toISOString()
            const originalObjectPath = `${userId}/${sessionId}/original/${videoId}.${extensionFor(
                declaredMediaType,
            )}`
            try {
                await persistence.createUpload(
                    {
                        sessionId,
                        videoId,
                        userId,
                        fileName: file.fileName.trim(),
                        declaredMediaType,
                        declaredByteSize: file.byteSize,
                        originalObjectPath,
                        uploadExpiresAt,
                    },
                    {
                        pointsEnabled:
                            options.pointsEnabled ??
                            getTaskPolicy().publicConfiguration().pointsEnabled,
                        minimumAvailablePoints:
                            getTaskPolicy().publicConfiguration().videoPointCost,
                        maximumConcurrentPerAccount: VIDEO_RULES.maximumConcurrentUploads,
                        maximumStartsPerWindow: VIDEO_RULES.maximumStartsPerWindow,
                        startWindowMs: VIDEO_RULES.startWindowMs,
                        workerHealthyWithinMs: VIDEO_RULES.workerHealthyWithinMs,
                        maximumWaitingPerHealthyWorker: VIDEO_RULES.maximumWaitingPerHealthyWorker,
                    },
                )
            } catch (error) {
                mapAdmissionError(error)
            }
            let qualification
            try {
                qualification = await storage.createSignedUpload(originalObjectPath)
            } catch (error) {
                await cancelAdmission(userId, videoId)
                throw error
            }
            log.debug(
                {
                    event: 'video_upload_session_issued',
                    correlationId: sessionId,
                    assetId: videoId,
                    stage: 'upload_session',
                    state: 'awaiting_upload',
                    declaredMediaType,
                    declaredByteSize: file.byteSize,
                    uploadLifetimeMs: VIDEO_RULES.signedUploadLifetimeMs,
                },
                '视频上传资格已签发',
            )
            return {
                sessionId,
                video: {
                    id: videoId,
                    fileName: file.fileName.trim(),
                    state: 'awaiting_upload' as const,
                    upload: {
                        endpoint: tusEndpoint,
                        signature: qualification.signature,
                        bucketName: VIDEO_RULES.storageBucket,
                        objectName: originalObjectPath,
                        expiresAt: uploadExpiresAt,
                    },
                },
            }
        },

        async confirmUpload(userId: string, videoId: string) {
            const asset = await persistence.findOwned(userId, videoId)
            if (!asset) {
                throw new VideoServiceError('VIDEO_NOT_FOUND', '视频不存在')
            }
            assertDraftVideoStillValid(asset)
            if (asset.state !== 'awaiting_upload') {
                return publicVideo(asset)
            }
            if (new Date(asset.uploadExpiresAt).getTime() <= clock.now().getTime()) {
                await cancelAdmission(userId, videoId)
                throw new VideoServiceError('VIDEO_UPLOAD_EXPIRED', '视频上传资格已过期')
            }
            log.debug(
                {
                    event: 'video_upload_confirmation_started',
                    correlationId: asset.uploadSessionId,
                    assetId: asset.id,
                    stage: 'upload_confirmation',
                    state: asset.state,
                },
                '开始复核已上传视频',
            )
            const object = await storage.info(asset.originalObjectPath)
            const objectFound = Boolean(object)
            const sizeMatches = object?.size === asset.declaredByteSize
            const mediaTypeMatches = object?.contentType === asset.declaredMediaType
            if (
                !object ||
                object.size !== asset.declaredByteSize ||
                object.contentType !== asset.declaredMediaType
            ) {
                log.debug(
                    {
                        event: 'video_upload_confirmation_mismatch',
                        correlationId: asset.uploadSessionId,
                        assetId: asset.id,
                        stage: 'upload_confirmation',
                        objectFound,
                        sizeMatches,
                        mediaTypeMatches,
                    },
                    '视频上传对象复核不一致',
                )
                await cancelAdmission(userId, videoId)
                throw new VideoServiceError('VIDEO_UPLOAD_MISMATCH', '上传对象与申请信息不一致')
            }
            const queued = await persistence.markQueued(userId, videoId, {
                byteSize: object.size,
                mediaType: object.contentType,
            })
            if (!queued) {
                throw new VideoServiceError(
                    'VIDEO_UPLOAD_EXPIRED',
                    '视频上传资格已过期或状态已改变',
                )
            }
            log.debug(
                {
                    event: 'video_upload_queued',
                    correlationId: asset.uploadSessionId,
                    assetId: asset.id,
                    stage: 'queue',
                    state: queued.state,
                    queuePosition: queued.queuePosition,
                    verifiedByteSize: object.size,
                    verifiedMediaType: object.contentType,
                },
                '视频上传已确认并进入预处理队列',
            )
            return publicVideo(queued)
        },

        async resumeUpload(userId: string, videoId: string) {
            const asset = await persistence.findOwned(userId, videoId)
            if (!asset) {
                throw new VideoServiceError('VIDEO_NOT_FOUND', '视频不存在')
            }
            assertDraftVideoStillValid(asset)
            if (asset.state !== 'awaiting_upload') {
                throw new VideoServiceError('VIDEO_UPLOAD_NOT_RESUMABLE', '当前视频不在可续传状态')
            }
            if (new Date(asset.uploadExpiresAt).getTime() <= clock.now().getTime()) {
                await cancelAdmission(userId, videoId)
                throw new VideoServiceError('VIDEO_UPLOAD_EXPIRED', '视频上传资格已过期')
            }
            return resumableSession(asset)
        },

        async getStatus(userId: string, videoId: string) {
            const asset = await persistence.findOwned(userId, videoId)
            if (!asset) {
                throw new VideoServiceError('VIDEO_NOT_FOUND', '视频不存在')
            }
            assertDraftVideoStillValid(asset)
            return publicVideo(asset)
        },

        async cancel(userId: string, videoId: string) {
            const cancelled = await persistence.cancelOwned(userId, videoId)
            if (cancelled) {
                return publicVideo(cancelled)
            }
            const existing = await persistence.findOwned(userId, videoId)
            if (!existing) {
                throw new VideoServiceError('VIDEO_NOT_FOUND', '视频不存在')
            }
            if (existing.state === 'cancelled') {
                return publicVideo(existing)
            }
            throw new VideoServiceError('VIDEO_UPLOAD_NOT_RESUMABLE', '当前视频无法取消')
        },
    }
}

/** 默认视频领域服务实例。 */
export const videoService = createVideoService()
