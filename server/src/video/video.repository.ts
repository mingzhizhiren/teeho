import { sql } from 'drizzle-orm'

import { VIDEO_RULES } from '../config/constants'
import {
    db,
    withTransaction,
    type DatabaseExecutor,
    type DatabaseTransaction,
} from '../db/database'
import { mapVideoAsset, type VideoAssetRow, videoAssetSelection } from './video.asset-record'
import type {
    CreateVideoUploadParam,
    ReadyVideoAnalysisEvidence,
    ReadyVideoEvidence,
    ReadyVideoEvidenceFrame,
    VerifiedVideoObject,
    VideoAdmissionPolicy,
    VideoAdmissionRejection,
    VideoAssetRecord,
    VideoAssetState,
    VideoEvidenceCleanupRecord,
    VideoFailureOutcome,
    VideoMediaType,
    VideoOriginalCleanupRecord,
    VideoPersistence,
    VideoProcessingFailure,
    VideoWorkerPersistence,
} from './video.contract'

function iso(value: Date | string) {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

/** 保持视频持久化公共契约的稳定导入入口。 */
export type {
    CreateVideoUploadParam,
    ReadyVideoAnalysisEvidence,
    ReadyVideoEvidence,
    ReadyVideoEvidenceFrame,
    VerifiedVideoObject,
    VideoAdmissionPolicy,
    VideoAdmissionRejection,
    VideoAssetRecord,
    VideoAssetState,
    VideoEvidenceCleanupRecord,
    VideoFailureOutcome,
    VideoMediaType,
    VideoOriginalCleanupRecord,
    VideoPersistence,
    VideoProcessingFailure,
    VideoWorkerPersistence,
}

/** 视频上传准入拒绝错误。 */
export class VideoAdmissionRejectedError extends Error {
    constructor(readonly code: VideoAdmissionRejection) {
        super(code)
        this.name = 'VideoAdmissionRejectedError'
    }
}

interface ReadyVideoAnalysisEvidenceRow extends Record<string, unknown> {
    assetId: string
    evidenceId: string
    evidenceVersion: string
    originalSha256: string
    durationMs: number | string
    width: number | string
    height: number | string
    container: string
    videoCodec: string
    hasAudio: boolean
    mediaMetadata: unknown
    expiresAt: Date | string
}

interface ReadyVideoAnalysisFrameRow extends Record<string, unknown> {
    timestampMs: number | string
    selectionReason: string
    objectPath: string
    sha256: string
    width: number | string
    height: number | string
    byteSize: number | string
    mediaType: string
}

/**
 * 在调用方 executor 中读取账号拥有、仍保留且版本受支持的 ready 视频证据。
 * 正式建任务在事务内调用，因此证据包会一直锁定到任务快照写入完成。
 */
export async function findReadyVideoEvidence(
    executor: DatabaseExecutor,
    userId: string,
    assetId: string,
): Promise<ReadyVideoAnalysisEvidence | null> {
    const packages = await executor.execute<ReadyVideoAnalysisEvidenceRow>(sql`
        SELECT
            asset.id::text AS "assetId",
            evidence.id::text AS "evidenceId",
            evidence.evidence_version AS "evidenceVersion",
            evidence.original_sha256 AS "originalSha256",
            evidence.duration_ms AS "durationMs",
            evidence.width,
            evidence.height,
            evidence.container,
            evidence.video_codec AS "videoCodec",
            evidence.has_audio AS "hasAudio",
            evidence.media_metadata AS "mediaMetadata",
            evidence.expires_at AS "expiresAt"
        FROM public.analysis_video_assets AS asset
        JOIN public.analysis_video_evidence_packages AS evidence
          ON evidence.id = asset.evidence_id
         AND evidence.asset_id = asset.id
        WHERE asset.id = ${assetId}::uuid
          AND asset.user_id = ${userId}::uuid
          AND asset.state = 'ready'
          AND evidence.evidence_version = ${VIDEO_RULES.evidenceVersion}
          AND evidence.cleanup_state = 'retained'
          AND evidence.expires_at > now()
        FOR KEY SHARE OF asset, evidence
    `)
    const evidence = packages[0]
    if (!evidence || evidence.evidenceVersion !== VIDEO_RULES.evidenceVersion) {
        return null
    }
    const rows = await executor.execute<ReadyVideoAnalysisFrameRow>(sql`
        SELECT
            frame.timestamp_ms AS "timestampMs",
            frame.selection_reason AS "selectionReason",
            frame.object_path AS "objectPath",
            frame.sha256,
            frame.width,
            frame.height,
            frame.byte_size AS "byteSize",
            frame.media_type AS "mediaType"
        FROM public.analysis_video_evidence_frames AS frame
        WHERE frame.evidence_package_id = ${evidence.evidenceId}::uuid
        ORDER BY frame.position
    `)
    if (rows.length === 0 || rows.length > VIDEO_RULES.maximumFrames) {
        return null
    }
    const frames = rows.map((frame) => ({
        timestampMs: Number(frame.timestampMs),
        selectionReason: frame.selectionReason,
        objectPath: frame.objectPath,
        sha256: frame.sha256,
        width: Number(frame.width),
        height: Number(frame.height),
        byteSize: Number(frame.byteSize),
        mediaType: frame.mediaType as ReadyVideoEvidenceFrame['mediaType'],
    }))
    if (
        frames.some(
            (frame) =>
                frame.mediaType !== 'image/webp' ||
                frame.byteSize < 1 ||
                frame.width < 1 ||
                frame.height < 1 ||
                Math.max(frame.width, frame.height) > VIDEO_RULES.frameMaximumEdgePixels ||
                !/^[0-9a-f]{64}$/u.test(frame.sha256),
        )
    ) {
        return null
    }
    const metadata = evidence.mediaMetadata
    return {
        assetId: evidence.assetId,
        evidenceId: evidence.evidenceId,
        evidenceVersion: VIDEO_RULES.evidenceVersion,
        originalSha256: evidence.originalSha256,
        durationMs: Number(evidence.durationMs),
        width: Number(evidence.width),
        height: Number(evidence.height),
        container: evidence.container,
        videoCodec: evidence.videoCodec,
        hasAudio: evidence.hasAudio,
        mediaMetadata:
            typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
                ? (metadata as Record<string, unknown>)
                : {},
        expiresAt: iso(evidence.expiresAt),
        frames,
    }
}

/** 在同一事务中创建上传资格和唯一视频资产。 */
export async function insertVideoUpload(executor: DatabaseExecutor, param: CreateVideoUploadParam) {
    await executor.execute(sql`
        INSERT INTO public.analysis_video_upload_sessions (
            id, user_id, state, expires_at
        )
        VALUES (
            ${param.sessionId}::uuid,
            ${param.userId}::uuid,
            'issued',
            ${param.uploadExpiresAt}::timestamptz
        )
    `)
    await executor.execute(sql`
        INSERT INTO public.analysis_video_assets (
            id,
            user_id,
            upload_session_id,
            state,
            file_name,
            declared_media_type,
            declared_byte_size,
            original_object_path,
            upload_expires_at
        )
        VALUES (
            ${param.videoId}::uuid,
            ${param.userId}::uuid,
            ${param.sessionId}::uuid,
            'awaiting_upload',
            ${param.fileName},
            ${param.declaredMediaType},
            ${param.declaredByteSize},
            ${param.originalObjectPath},
            ${param.uploadExpiresAt}::timestamptz
        )
    `)
}

/** 只按账号所有权读取视频，不向浏览器暴露数据库表。 */
export async function findOwnedVideoAsset(
    userId: string,
    videoId: string,
    executor: DatabaseExecutor = db,
) {
    const rows = await executor.execute<VideoAssetRow>(sql`
        SELECT ${videoAssetSelection}
        FROM public.analysis_video_assets asset
        WHERE asset.id = ${videoId}::uuid
          AND asset.user_id = ${userId}::uuid
        LIMIT 1
    `)
    return rows[0] ? mapVideoAsset(rows[0]) : null
}

/** 服务端复核 Storage 对象后，将上传会话和视频原子地转入队列。 */
export async function markVideoQueued(
    userId: string,
    videoId: string,
    object: VerifiedVideoObject,
) {
    return withTransaction(async (transaction) => {
        const rows = await transaction.execute<VideoAssetRow>(sql`
            UPDATE public.analysis_video_assets asset
            SET state = 'queued',
                verified_media_type = ${object.mediaType},
                verified_byte_size = ${object.byteSize},
                uploaded_at = now(),
                queued_at = now(),
                next_attempt_at = now(),
                failure_code = NULL,
                failure_detail = NULL,
                updated_at = now()
            WHERE asset.id = ${videoId}::uuid
              AND asset.user_id = ${userId}::uuid
              AND asset.state = 'awaiting_upload'
              AND asset.upload_expires_at > now()
            RETURNING ${videoAssetSelection}
        `)
        const asset = rows[0]
        if (!asset) {
            return null
        }
        await transaction.execute(sql`
            UPDATE public.analysis_video_upload_sessions
            SET state = 'queued', updated_at = now()
            WHERE id = ${asset.uploadSessionId}::uuid
              AND user_id = ${userId}::uuid
        `)
        return mapVideoAsset(asset)
    })
}

interface CountRow extends Record<string, unknown> {
    count: number | string
}

/** 在调用方事务中串行检查全局容量、账号占用与实际启动窗口。 */
export async function assertVideoAdmission(
    transaction: DatabaseTransaction,
    param: CreateVideoUploadParam,
    policy: VideoAdmissionPolicy,
) {
    await transaction.execute(sql`
        SELECT pg_advisory_xact_lock(
            hashtextextended('video:admission'::text, 0)
        )
    `)
    await transaction.execute(sql`
        SELECT pg_advisory_xact_lock(
            hashtextextended(${'video:account:' + param.userId}::text, 0)
        )
    `)
    await transaction.execute(sql`
        WITH expired_assets AS (
            UPDATE public.analysis_video_assets
            SET state = 'expired', updated_at = now()
            WHERE state = 'awaiting_upload'
              AND upload_expires_at <= now()
            RETURNING upload_session_id
        )
        UPDATE public.analysis_video_upload_sessions session
        SET state = 'expired', updated_at = now()
        FROM expired_assets expired
        WHERE session.id = expired.upload_session_id
    `)

    const healthyWorkers = await transaction.execute<CountRow>(sql`
        SELECT count(*) AS count
        FROM public.analysis_video_workers
        WHERE status = 'healthy'
          AND last_heartbeat_at >
              now() - (${policy.workerHealthyWithinMs} * interval '1 millisecond')
    `)
    const healthyWorkerCount = Number(healthyWorkers[0]?.count ?? 0)
    if (healthyWorkerCount < 1) {
        throw new VideoAdmissionRejectedError('worker_unavailable')
    }

    const waitingAssets = await transaction.execute<CountRow>(sql`
        SELECT count(*) AS count
        FROM public.analysis_video_assets
        WHERE state IN ('awaiting_upload', 'uploaded', 'queued')
          AND user_id <> ${param.userId}::uuid
    `)
    const maximumWaiting = healthyWorkerCount * policy.maximumWaitingPerHealthyWorker
    if (Number(waitingAssets[0]?.count ?? 0) >= maximumWaiting) {
        throw new VideoAdmissionRejectedError('global_capacity_reached')
    }

    await cancelReplacedVideoUploads(transaction, param.userId)

    const countedStarts = await transaction.execute<CountRow>(sql`
        SELECT count(*) AS count
        FROM public.analysis_video_start_events
        WHERE user_id = ${param.userId}::uuid
          AND state = 'counted'
          AND started_at >
              now() - (${policy.startWindowMs} * interval '1 millisecond')
    `)
    if (Number(countedStarts[0]?.count ?? 0) >= policy.maximumStartsPerWindow) {
        throw new VideoAdmissionRejectedError('start_rate_limited')
    }
}

/** 在准入锁与同一事务内替换本账号旧上传，终态原文件交给既有清理租约处理。 */
async function cancelReplacedVideoUploads(transaction: DatabaseTransaction, userId: string) {
    await transaction.execute(sql`
        WITH cancelled_assets AS (
            UPDATE public.analysis_video_assets
            SET state = 'cancelled', cancellation_requested_at = now(),
                next_attempt_at = NULL, failure_code = NULL, failure_detail = NULL,
                updated_at = now()
            WHERE user_id = ${userId}::uuid
              AND state IN ('awaiting_upload', 'uploaded', 'queued', 'processing')
            RETURNING id, upload_session_id, processing_attempt_count
        ), cancelled_attempts AS (
            UPDATE public.analysis_video_processing_attempts attempt
            SET state = 'cancelled', failure_code = 'video_cancelled',
                completed_at = now(), lease_expires_at = NULL, updated_at = now()
            FROM cancelled_assets asset
            WHERE attempt.asset_id = asset.id
              AND attempt.attempt_number = asset.processing_attempt_count
              AND attempt.state = 'processing'
        )
        UPDATE public.analysis_video_upload_sessions session
        SET state = 'cancelled', updated_at = now()
        FROM cancelled_assets asset
        WHERE session.id = asset.upload_session_id
          AND session.user_id = ${userId}::uuid
    `)
}

/** 用户删除或替换素材时原子取消旧资产；在途 Worker 随后的提交会因状态守卫失效。 */
export async function cancelVideoAsset(userId: string, videoId: string) {
    return withTransaction(async (transaction) => {
        const rows = await transaction.execute<VideoAssetRow>(sql`
            UPDATE public.analysis_video_assets asset
            SET state = 'cancelled',
                cancellation_requested_at = now(),
                next_attempt_at = NULL,
                failure_code = NULL,
                failure_detail = NULL,
                updated_at = now()
            WHERE asset.id = ${videoId}::uuid
              AND asset.user_id = ${userId}::uuid
              AND asset.state IN (
                  'awaiting_upload',
                  'uploaded',
                  'queued',
                  'processing',
                  'ready',
                  'deterministic_failed',
                  'technical_failed'
              )
            RETURNING ${videoAssetSelection}
        `)
        const row = rows[0]
        if (!row) {
            return null
        }
        await transaction.execute(sql`
            UPDATE public.analysis_video_processing_attempts attempt
            SET state = 'cancelled',
                failure_code = 'video_cancelled',
                completed_at = now(),
                lease_expires_at = NULL,
                updated_at = now()
            WHERE attempt.asset_id = ${videoId}::uuid
              AND attempt.attempt_number = ${Number(row.processingAttemptCount)}
              AND attempt.state = 'processing'
        `)
        await transaction.execute(sql`
            UPDATE public.analysis_video_upload_sessions
            SET state = 'cancelled', updated_at = now()
            WHERE id = ${row.uploadSessionId}::uuid
              AND user_id = ${userId}::uuid
        `)
        return mapVideoAsset(row)
    })
}

/** 正式视频分析成功后，在结果与积分事务内清空账号当前计数。 */
export async function resetVideoStartEventsForAnalysisSuccess(
    executor: DatabaseExecutor,
    userId: string,
    assetId: string,
) {
    await executor.execute(sql`
        UPDATE public.analysis_video_start_events AS event
        SET state = 'reset',
            reset_at = now(),
            release_reason = 'video_succeeded',
            updated_at = now()
        WHERE event.user_id = ${userId}::uuid
          AND event.state = 'counted'
          AND EXISTS (
              SELECT 1
              FROM public.analysis_video_assets AS asset
              WHERE asset.id = ${assetId}::uuid
                AND asset.user_id = event.user_id
                AND asset.state = 'ready'
          )
    `)
}
