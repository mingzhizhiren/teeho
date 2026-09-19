import { mkdtemp, rm } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import path from 'node:path'

import { VIDEO_RULES } from '../config/constants'
import { logger } from '../utils/logger'
import { runVideoEvidenceCleanup } from './video.evidence-cleanup'
import {
    ffmpegVideoMediaProcessor,
    VideoEvidenceValidationError,
    VideoMediaProcessError,
    type ProcessedVideoEvidence,
    type VideoMediaProcessor,
} from './video.media'
import {
    type ReadyVideoEvidence,
    type VideoAssetRecord,
    type VideoProcessingFailure,
    type VideoWorkerPersistence,
} from './video.repository'
import { postgresVideoWorkerPersistence } from './video.worker.repository'
import { inspectVideoRuntime, type VideoRuntimeDescriptor } from './video.runtime'
import { supabaseVideoObjectStorage, type VideoObjectStorage } from './video.storage'

const evidenceFramePositionWidth = 3

interface VideoWorkerClock {
    now: () => Date
    randomUUID: () => string
}

interface VideoPreprocessingWorkerOptions {
    workerId?: string
    storage?: VideoObjectStorage
    persistence?: VideoWorkerPersistence
    media?: VideoMediaProcessor
    clock?: VideoWorkerClock
    pollIntervalMs?: number
    heartbeatIntervalMs?: number
    processingTimeoutMs?: number
    preflight?: () => Promise<VideoRuntimeDescriptor>
    createWorkingDirectory?: () => Promise<string>
    log?: VideoWorkerLogger
}

type VideoWorkerLogger = Pick<typeof logger, 'error' | 'info' | 'warn'> &
    Partial<Pick<typeof logger, 'debug'>>

type VideoProcessingStage = 'download' | 'process' | 'upload_frames' | 'upload_manifest' | 'commit'

type VideoWorkerStageDurationName =
    | 'workingDirectory'
    | 'download'
    | 'process'
    | 'buildEvidence'
    | 'uploadFrames'
    | 'uploadManifest'
    | 'commit'
    | 'originalCleanup'
    | 'localCleanup'

const systemClock: VideoWorkerClock = {
    now: () => new Date(),
    randomUUID: () => crypto.randomUUID(),
}

class VideoAttemptTimeoutError extends Error {
    readonly code = 'ffmpeg_timeout'

    constructor() {
        super('视频预处理超过整段执行时限')
        this.name = 'VideoAttemptTimeoutError'
    }
}

class VideoLeaseLostError extends Error {
    readonly code = 'video_lease_lost'

    constructor() {
        super('视频处理租约已失效')
        this.name = 'VideoLeaseLostError'
    }
}

function evidenceBasePath(asset: VideoAssetRecord, evidenceId: string) {
    return `${asset.userId}/${asset.uploadSessionId}/evidence/${evidenceId}`
}

function manifestContent(evidence: ReadyVideoEvidence) {
    return new TextEncoder().encode(
        JSON.stringify({
            ...evidence,
            frames: evidence.frames.map((frame) => ({ ...frame })),
            status: 'ready',
        }),
    )
}

function readyEvidence(
    processed: ProcessedVideoEvidence,
    asset: VideoAssetRecord,
    evidenceId: string,
    generatedAt: string,
) {
    const basePath = evidenceBasePath(asset, evidenceId)
    const expiresAt = new Date(
        new Date(generatedAt).getTime() + VIDEO_RULES.evidenceRetentionMs,
    ).toISOString()
    return {
        id: evidenceId,
        evidenceVersion: VIDEO_RULES.evidenceVersion,
        originalSha256: processed.originalSha256,
        durationMs: processed.media.durationMs,
        width: processed.media.width,
        height: processed.media.height,
        container: processed.media.container,
        videoCodec: processed.media.videoCodec,
        hasAudio: processed.media.hasAudio,
        mediaMetadata: { ...processed.media },
        pipelineVersion: VIDEO_RULES.pipelineVersion,
        pipelineConfigVersion: VIDEO_RULES.pipelineConfigVersion,
        ffmpegVersion: processed.ffmpegVersion,
        manifestObjectPath: `${basePath}/manifest.json`,
        generatedAt,
        expiresAt,
        frames: processed.frames.map((frame, position) => ({
            timestampMs: frame.timestampMs,
            selectionReason: frame.selectionReason,
            objectPath: `${basePath}/frames/${position
                .toString()
                .padStart(evidenceFramePositionWidth, '0')}.webp`,
            sha256: frame.sha256,
            width: frame.width,
            height: frame.height,
            byteSize: frame.byteSize,
            mediaType: frame.mediaType,
        })),
    } satisfies ReadyVideoEvidence
}

function classifyFailure(error: unknown, stage: VideoProcessingStage): VideoProcessingFailure {
    if (error instanceof VideoEvidenceValidationError) {
        return { kind: 'deterministic', code: error.code }
    }
    if (
        error instanceof VideoAttemptTimeoutError ||
        error instanceof VideoLeaseLostError ||
        error instanceof VideoMediaProcessError
    ) {
        return { kind: 'technical', code: error.code }
    }
    const stageCodes: Record<VideoProcessingStage, string> = {
        download: 'video_original_download_failed',
        process: 'video_processing_failed',
        upload_frames: 'video_frame_upload_failed',
        upload_manifest: 'video_manifest_upload_failed',
        commit: 'video_evidence_commit_failed',
    }
    return { kind: 'technical', code: stageCodes[stage] }
}

/** 独立进程运行的 PostgreSQL 队列消费者；默认单并发。 */
export class VideoPreprocessingWorker {
    private readonly workerId: string
    private readonly storage: VideoObjectStorage
    private readonly persistence: VideoWorkerPersistence
    private readonly media: VideoMediaProcessor
    private readonly clock: VideoWorkerClock
    private readonly pollIntervalMs: number
    private readonly heartbeatIntervalMs: number
    private readonly processingTimeoutMs: number
    private readonly preflight: () => Promise<VideoRuntimeDescriptor>
    private readonly createWorkingDirectory: () => Promise<string>
    private readonly log: VideoWorkerLogger
    private pollTimer: ReturnType<typeof setInterval> | undefined
    private workerHeartbeatTimer: ReturnType<typeof setInterval> | undefined
    private activeAttemptController: AbortController | undefined
    private running = false
    private registered = false
    private workerHeartbeatFailureLogged = false

    constructor(options: VideoPreprocessingWorkerOptions = {}) {
        this.workerId = options.workerId ?? `${hostname()}-${process.pid}-${crypto.randomUUID()}`
        this.storage = options.storage ?? supabaseVideoObjectStorage
        this.persistence = options.persistence ?? postgresVideoWorkerPersistence
        this.media = options.media ?? ffmpegVideoMediaProcessor
        this.clock = options.clock ?? systemClock
        this.pollIntervalMs = options.pollIntervalMs ?? VIDEO_RULES.processingPollIntervalMs
        this.heartbeatIntervalMs =
            options.heartbeatIntervalMs ?? VIDEO_RULES.workerHeartbeatIntervalMs
        this.processingTimeoutMs = options.processingTimeoutMs ?? VIDEO_RULES.processingTimeoutMs
        this.preflight = options.preflight ?? inspectVideoRuntime
        this.createWorkingDirectory =
            options.createWorkingDirectory ??
            (() => mkdtemp(path.join(tmpdir(), 'teeho-video-worker-')))
        this.log = options.log ?? logger
    }

    private async measureStage<T>(
        durations: Partial<Record<VideoWorkerStageDurationName, number>>,
        stage: VideoWorkerStageDurationName,
        operation: () => T | Promise<T>,
    ) {
        const startedAt = this.clock.now().getTime()
        try {
            return await operation()
        } finally {
            durations[stage] = Math.max(0, this.clock.now().getTime() - startedAt)
        }
    }

    private debugStage(
        asset: VideoAssetRecord,
        event: string,
        stage: string,
        fields: Record<string, unknown> = {},
    ) {
        this.log.debug?.(
            {
                event,
                correlationId: asset.uploadSessionId,
                assetId: asset.id,
                workerId: this.workerId,
                attemptNumber: asset.processingAttemptCount,
                stage,
                ...fields,
            },
            '视频预处理阶段状态',
        )
    }

    async start() {
        if (this.registered) {
            return
        }
        const runtime = await this.preflight()
        this.log.debug?.(
            {
                event: 'video_worker_preflight_completed',
                workerId: this.workerId,
                stage: 'worker_preflight',
                ffmpegVersion: runtime.ffmpegVersion,
                ffprobeVersion: runtime.ffprobeVersion,
                h264Available: runtime.capabilities.h264,
                hevcAvailable: runtime.capabilities.hevc,
            },
            '视频 Worker 运行环境检查完成',
        )
        await this.persistence.registerWorker(this.workerId, runtime)
        this.registered = true
        this.log.debug?.(
            {
                event: 'video_worker_registered',
                workerId: this.workerId,
                stage: 'worker_registration',
                pollIntervalMs: this.pollIntervalMs,
                heartbeatIntervalMs: this.heartbeatIntervalMs,
                processingTimeoutMs: this.processingTimeoutMs,
            },
            '视频 Worker 已注册并开始轮询',
        )
        this.pollTimer = setInterval(() => this.wake(), this.pollIntervalMs)
        this.workerHeartbeatTimer = setInterval(
            () => void this.writeWorkerHeartbeat(),
            this.heartbeatIntervalMs,
        )
        this.wake()
    }

    async stop() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer)
            this.pollTimer = undefined
        }
        if (this.workerHeartbeatTimer) {
            clearInterval(this.workerHeartbeatTimer)
            this.workerHeartbeatTimer = undefined
        }
        this.activeAttemptController?.abort()
        if (this.registered) {
            await this.persistence.stopWorker(this.workerId)
            this.registered = false
        }
    }

    private async writeWorkerHeartbeat() {
        try {
            await this.persistence.heartbeatWorker(this.workerId)
            if (this.workerHeartbeatFailureLogged) {
                this.log.info(
                    {
                        event: 'video_worker_heartbeat_recovered',
                        workerId: this.workerId,
                        stage: 'worker_heartbeat',
                    },
                    '视频 Worker 心跳已恢复',
                )
                this.workerHeartbeatFailureLogged = false
            }
        } catch (error) {
            if (!this.workerHeartbeatFailureLogged) {
                this.workerHeartbeatFailureLogged = true
                this.log.warn(
                    {
                        event: 'video_worker_heartbeat_failed',
                        workerId: this.workerId,
                        stage: 'worker_heartbeat',
                        errorCode: 'video_worker_heartbeat_failed',
                        err: error,
                    },
                    '视频 Worker 心跳写入失败',
                )
            }
        }
    }

    private wake() {
        if (this.running) {
            return
        }
        this.running = true
        void this.runOnce().finally(() => {
            this.running = false
        })
    }

    private async recoverExpiredLeases() {
        try {
            const recoveredCount = await this.persistence.recoverExpiredLeases()
            if (recoveredCount > 0) {
                this.log.warn(
                    {
                        event: 'video_leases_recovered',
                        workerId: this.workerId,
                        recoveredCount,
                    },
                    '已回收失去心跳的视频处理租约',
                )
            }
            return recoveredCount
        } catch (error) {
            this.log.warn(
                {
                    event: 'video_lease_recovery_failed',
                    workerId: this.workerId,
                    stage: 'lease_recovery',
                    errorCode: 'video_lease_recovery_failed',
                    errorName: error instanceof Error ? error.name : 'UnknownError',
                },
                '视频处理租约回收失败',
            )
            return 0
        }
    }

    private startLeaseHeartbeat(assetId: string, controller: AbortController) {
        let failureLogged = false
        return setInterval(() => {
            void this.persistence
                .heartbeatLease(this.workerId, assetId, VIDEO_RULES.processingLeaseMs)
                .then((renewed) => {
                    if (failureLogged && renewed) {
                        this.log.info(
                            {
                                event: 'video_lease_heartbeat_recovered',
                                assetId,
                                workerId: this.workerId,
                                stage: 'lease_heartbeat',
                            },
                            '视频处理租约续期已恢复',
                        )
                        failureLogged = false
                    }
                    if (!renewed) {
                        controller.abort()
                    }
                })
                .catch((error: unknown) => {
                    if (!failureLogged) {
                        failureLogged = true
                        this.log.warn(
                            {
                                event: 'video_lease_heartbeat_failed',
                                assetId,
                                workerId: this.workerId,
                                stage: 'lease_heartbeat',
                                errorCode: 'video_lease_heartbeat_failed',
                                err: error,
                            },
                            '视频处理租约续期失败',
                        )
                    }
                })
        }, this.heartbeatIntervalMs)
    }

    private assertActive(controller: AbortController) {
        if (controller.signal.aborted) {
            throw new VideoLeaseLostError()
        }
    }

    private async processMediaWithTimeout(
        inputPath: string,
        workingDirectory: string,
        asset: VideoAssetRecord,
        controller: AbortController,
    ) {
        let timeout: ReturnType<typeof setTimeout> | undefined
        const timeoutPromise = new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
                reject(new VideoAttemptTimeoutError())
                controller.abort()
            }, this.processingTimeoutMs)
        })
        try {
            return await Promise.race([
                this.media.process(inputPath, {
                    workingDirectory,
                    fileName: asset.fileName,
                    declaredMediaType: asset.declaredMediaType,
                    signal: controller.signal,
                    timeoutMs: this.processingTimeoutMs,
                }),
                timeoutPromise,
            ])
        } finally {
            if (timeout) {
                clearTimeout(timeout)
            }
        }
    }

    private async cleanupOriginal(assetId?: string) {
        let cleanup
        try {
            cleanup = await this.persistence.claimOriginalCleanup(
                this.workerId,
                VIDEO_RULES.processingLeaseMs,
                assetId,
            )
        } catch (error) {
            this.log.warn(
                {
                    event: 'video_original_cleanup_claim_failed',
                    assetId,
                    workerId: this.workerId,
                    stage: 'original_cleanup_claim',
                    errorCode: 'video_original_cleanup_claim_failed',
                    errorName: error instanceof Error ? error.name : 'UnknownError',
                },
                '原视频清理任务领取失败',
            )
            return false
        }
        if (!cleanup) {
            return false
        }
        try {
            await this.storage.remove([cleanup.originalObjectPath])
            const completed = await this.persistence.completeOriginalCleanup(
                cleanup.assetId,
                this.workerId,
            )
            if (!completed) {
                this.log.warn(
                    {
                        event: 'video_original_cleanup_commit_failed',
                        assetId: cleanup.assetId,
                        workerId: this.workerId,
                        stage: 'original_cleanup_commit',
                        errorCode: 'video_original_cleanup_lease_lost',
                    },
                    '原视频已删除，但清理租约提交失败',
                )
            } else {
                this.log.info(
                    {
                        event: 'video_original_cleanup_completed',
                        assetId: cleanup.assetId,
                        workerId: this.workerId,
                        stage: 'original_cleanup',
                        cleanupResult: 'deleted',
                    },
                    '原视频清理完成',
                )
            }
        } catch (error) {
            await this.persistence.failOriginalCleanup(
                cleanup.assetId,
                this.workerId,
                'video_original_delete_failed',
            )
            this.log.warn(
                {
                    event: 'video_original_cleanup_failed',
                    assetId: cleanup.assetId,
                    workerId: this.workerId,
                    stage: 'original_cleanup',
                    errorCode: 'video_original_delete_failed',
                    errorName: error instanceof Error ? error.name : 'UnknownError',
                },
                '原视频删除失败，已安排重试',
            )
        }
        return true
    }

    /** 队列空闲时批量清理到期证据；每项都通过数据库租约独立收敛。 */
    private async cleanupEvidence() {
        try {
            const summary = await runVideoEvidenceCleanup({
                claim: () =>
                    this.persistence.claimEvidenceCleanup(
                        this.workerId,
                        VIDEO_RULES.evidenceCleanupLeaseMs,
                    ),
                remove: (paths) => this.storage.remove(paths),
                complete: (evidenceId) =>
                    this.persistence.completeEvidenceCleanup(evidenceId, this.workerId),
                fail: (evidenceId, errorCode) =>
                    this.persistence.failEvidenceCleanup(evidenceId, this.workerId, errorCode),
            })
            if (summary.claimed > 0) {
                this.log.info(
                    {
                        event: 'video_evidence_cleanup_completed',
                        workerId: this.workerId,
                        ...summary,
                    },
                    '到期视频证据清理完成',
                )
            }
            return summary.claimed > 0
        } catch (error) {
            this.log.warn(
                {
                    event: 'video_evidence_cleanup_failed',
                    workerId: this.workerId,
                    stage: 'evidence_cleanup',
                    errorCode: 'video_evidence_cleanup_failed',
                    errorName: error instanceof Error ? error.name : 'UnknownError',
                },
                '到期视频证据清理失败',
            )
            return false
        }
    }

    /** 领取并完成一条视频；无任务或领取异常时返回 false。 */
    async runOnce() {
        const recoveredCount = await this.recoverExpiredLeases()
        if (recoveredCount > 0) {
            await this.cleanupOriginal()
        }
        let asset: VideoAssetRecord | null
        try {
            asset = await this.persistence.claimNext(this.workerId, VIDEO_RULES.processingLeaseMs)
        } catch (error) {
            this.log.warn(
                {
                    event: 'video_preprocessing_claim_failed',
                    workerId: this.workerId,
                    stage: 'claim',
                    errorCode: 'video_claim_failed',
                    errorName: error instanceof Error ? error.name : 'UnknownError',
                },
                '领取视频预处理任务失败',
            )
            return false
        }
        if (!asset) {
            const originalCleaned = await this.cleanupOriginal()
            const evidenceCleaned = await this.cleanupEvidence()
            return originalCleaned || evidenceCleaned
        }

        this.debugStage(asset, 'video_preprocessing_claimed', 'claim', {
            state: asset.state,
            declaredMediaType: asset.declaredMediaType,
            declaredByteSize: asset.declaredByteSize,
        })

        const startedAt = this.clock.now().getTime()
        const controller = new AbortController()
        this.activeAttemptController = controller
        const leaseTimer = this.startLeaseHeartbeat(asset.id, controller)
        let workingDirectory: string | undefined
        let stage: VideoProcessingStage = 'download'
        const uploadedPaths: string[] = []
        const stageDurationsMs: Partial<Record<VideoWorkerStageDurationName, number>> = {}
        try {
            this.debugStage(asset, 'video_preprocessing_stage_started', 'working_directory')
            workingDirectory = await this.measureStage(
                stageDurationsMs,
                'workingDirectory',
                this.createWorkingDirectory,
            )
            this.debugStage(asset, 'video_preprocessing_stage_completed', 'working_directory', {
                durationMs: stageDurationsMs.workingDirectory,
            })
            const extension = asset.declaredMediaType === 'video/mp4' ? 'mp4' : 'mov'
            const originalPath = path.join(workingDirectory, `original.${extension}`)
            this.debugStage(asset, 'video_preprocessing_stage_started', 'download')
            await this.measureStage(stageDurationsMs, 'download', () =>
                this.storage.downloadToFile(
                    asset.originalObjectPath,
                    originalPath,
                    controller.signal,
                ),
            )
            this.debugStage(asset, 'video_preprocessing_stage_completed', 'download', {
                durationMs: stageDurationsMs.download,
            })
            this.assertActive(controller)
            stage = 'process'
            this.debugStage(asset, 'video_preprocessing_stage_started', 'process')
            const processed = await this.measureStage(stageDurationsMs, 'process', () =>
                this.processMediaWithTimeout(originalPath, workingDirectory!, asset, controller),
            )
            this.debugStage(asset, 'video_preprocessing_stage_completed', 'process', {
                durationMs: stageDurationsMs.process,
                frameCount: processed.frames.length,
                mediaDurationMs: processed.media.durationMs,
                mediaWidth: processed.media.width,
                mediaHeight: processed.media.height,
                videoCodec: processed.media.videoCodec,
                hasAudio: processed.media.hasAudio,
            })
            this.assertActive(controller)
            const evidence = await this.measureStage(stageDurationsMs, 'buildEvidence', () =>
                readyEvidence(
                    processed,
                    asset,
                    this.clock.randomUUID(),
                    this.clock.now().toISOString(),
                ),
            )
            stage = 'upload_frames'
            this.debugStage(asset, 'video_preprocessing_stage_started', 'upload_frames', {
                frameCount: processed.frames.length,
            })
            await this.measureStage(stageDurationsMs, 'uploadFrames', async () => {
                for (const [position, frame] of processed.frames.entries()) {
                    this.assertActive(controller)
                    const objectPath = evidence.frames[position]!.objectPath
                    await this.storage.upload(objectPath, frame.content, frame.mediaType)
                    uploadedPaths.push(objectPath)
                }
            })
            this.debugStage(asset, 'video_preprocessing_stage_completed', 'upload_frames', {
                durationMs: stageDurationsMs.uploadFrames,
                frameCount: processed.frames.length,
            })
            stage = 'upload_manifest'
            this.assertActive(controller)
            this.debugStage(asset, 'video_preprocessing_stage_started', 'upload_manifest')
            await this.measureStage(stageDurationsMs, 'uploadManifest', () =>
                this.storage.upload(
                    evidence.manifestObjectPath,
                    manifestContent(evidence),
                    'application/json',
                ),
            )
            this.debugStage(asset, 'video_preprocessing_stage_completed', 'upload_manifest', {
                durationMs: stageDurationsMs.uploadManifest,
            })
            uploadedPaths.push(evidence.manifestObjectPath)
            stage = 'commit'
            this.assertActive(controller)
            this.debugStage(asset, 'video_preprocessing_stage_started', 'commit')
            await this.measureStage(stageDurationsMs, 'commit', async () => {
                if (!(await this.persistence.markReady(asset.id, this.workerId, evidence))) {
                    throw new VideoLeaseLostError()
                }
            })
            this.debugStage(asset, 'video_preprocessing_stage_completed', 'commit', {
                durationMs: stageDurationsMs.commit,
                evidenceId: evidence.id,
            })
            await this.measureStage(stageDurationsMs, 'originalCleanup', () =>
                this.cleanupOriginal(asset.id),
            )
            this.log.info(
                {
                    event: 'video_preprocessing_completed',
                    correlationId: asset.uploadSessionId,
                    assetId: asset.id,
                    evidenceId: evidence.id,
                    workerId: this.workerId,
                    attemptNumber: asset.processingAttemptCount,
                    stage: 'complete',
                    frameCount: evidence.frames.length,
                    ffmpegVersion: processed.ffmpegVersion,
                    mediaProbe: {
                        durationMs: processed.media.durationMs,
                        width: processed.media.width,
                        height: processed.media.height,
                        container: processed.media.container,
                        videoCodec: processed.media.videoCodec,
                        hasAudio: processed.media.hasAudio,
                    },
                    candidateCounts: {
                        temporal: processed.diagnostics.temporalCandidateCount,
                        scene: processed.diagnostics.sceneCandidateCount,
                        discarded: processed.diagnostics.discardedCandidateCount,
                        final: processed.diagnostics.selectedFrameCount,
                    },
                    stageDurationsMs: {
                        ...stageDurationsMs,
                        media: processed.diagnostics.stageDurationsMs,
                    },
                    durationMs: this.clock.now().getTime() - startedAt,
                },
                '视频预处理完成',
            )
        } catch (error) {
            if (uploadedPaths.length > 0) {
                try {
                    await this.storage.remove(uploadedPaths)
                } catch (cleanupError) {
                    this.log.warn(
                        {
                            event: 'video_partial_evidence_cleanup_failed',
                            correlationId: asset.uploadSessionId,
                            assetId: asset.id,
                            workerId: this.workerId,
                            attemptNumber: asset.processingAttemptCount,
                            stage: 'partial_evidence_cleanup',
                            errorCode: 'video_partial_evidence_cleanup_failed',
                            errorName:
                                cleanupError instanceof Error ? cleanupError.name : 'UnknownError',
                        },
                        '视频部分证据清理失败',
                    )
                }
            }
            const failure = classifyFailure(error, stage)
            const outcome = await this.persistence.markFailed(asset.id, this.workerId, failure)
            if (outcome === 'terminal' || outcome === 'stale') {
                await this.cleanupOriginal(asset.id)
            }
            const failureFields = {
                event: 'video_preprocessing_failed',
                correlationId: asset.uploadSessionId,
                assetId: asset.id,
                workerId: this.workerId,
                attemptNumber: asset.processingAttemptCount,
                stage,
                errorCode: failure.code,
                failureKind: failure.kind,
                failureOutcome: outcome,
                errorName: error instanceof Error ? error.name : 'UnknownError',
                exitCode: error instanceof VideoMediaProcessError ? error.exitCode : undefined,
                stderrExcerpt:
                    error instanceof VideoMediaProcessError
                        ? (error.stderrExcerpt ?? undefined)
                        : undefined,
                stageDurationsMs,
                durationMs: this.clock.now().getTime() - startedAt,
            }
            if (failure.kind === 'deterministic' && outcome === 'terminal') {
                this.log.info(failureFields, '视频预处理失败')
            } else if (failure.kind === 'technical' && outcome === 'terminal') {
                this.log.error(failureFields, '视频预处理失败')
            } else {
                this.log.warn(failureFields, '视频预处理失败')
            }
        } finally {
            clearInterval(leaseTimer)
            this.activeAttemptController = undefined
            if (workingDirectory) {
                try {
                    await this.measureStage(stageDurationsMs, 'localCleanup', () =>
                        rm(workingDirectory!, { force: true, recursive: true }),
                    )
                } catch (error) {
                    this.log.warn(
                        {
                            event: 'video_local_cleanup_failed',
                            correlationId: asset.uploadSessionId,
                            assetId: asset.id,
                            workerId: this.workerId,
                            attemptNumber: asset.processingAttemptCount,
                            stage: 'local_cleanup',
                            errorCode: 'video_local_cleanup_failed',
                            errorName: error instanceof Error ? error.name : 'UnknownError',
                        },
                        '视频本地临时资源清理失败',
                    )
                }
            }
        }
        return true
    }
}
