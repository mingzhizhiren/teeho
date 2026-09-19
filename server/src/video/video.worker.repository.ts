import { sql } from 'drizzle-orm'

import { VIDEO_RULES } from '../config/constants'
import { db, withTransaction, type DatabaseExecutor } from '../db/database'
import { maintenanceClaimAllowedSql } from '../runtime/task-policy'
import { mapVideoAsset, type VideoAssetRow, videoAssetSelection } from './video.asset-record'
import type {
    ReadyVideoEvidence,
    VideoEvidenceCleanupRecord,
    VideoFailureOutcome,
    VideoProcessingFailure,
    VideoWorkerPersistence,
} from './video.contract'
import type { VideoRuntimeDescriptor } from './video.runtime'

/** Worker 只有通过本机媒体能力预检后，才会登记为健康。 */
export async function registerVideoWorker(
    workerId: string,
    runtime: VideoRuntimeDescriptor,
    executor: DatabaseExecutor = db,
) {
    await executor.execute(sql`
        INSERT INTO public.analysis_video_workers (
            worker_id,
            status,
            last_heartbeat_at,
            ffmpeg_version,
            ffprobe_version,
            capabilities,
            started_at,
            stopped_at
        )
        VALUES (
            ${workerId},
            'healthy',
            now(),
            ${runtime.ffmpegVersion},
            ${runtime.ffprobeVersion},
            ${JSON.stringify(runtime.capabilities)}::jsonb,
            now(),
            NULL
        )
        ON CONFLICT (worker_id) DO UPDATE
        SET status = 'healthy',
            last_heartbeat_at = now(),
            ffmpeg_version = EXCLUDED.ffmpeg_version,
            ffprobe_version = EXCLUDED.ffprobe_version,
            capabilities = EXCLUDED.capabilities,
            started_at = now(),
            stopped_at = NULL,
            updated_at = now()
    `)
}

/** 刷新视频 Worker 的健康心跳。 */
export async function heartbeatVideoWorker(workerId: string, executor: DatabaseExecutor = db) {
    await executor.execute(sql`
        UPDATE public.analysis_video_workers
        SET last_heartbeat_at = now(), updated_at = now()
        WHERE worker_id = ${workerId}
          AND status = 'healthy'
    `)
}

/** 将视频 Worker 标记为已停止。 */
export async function stopVideoWorker(workerId: string, executor: DatabaseExecutor = db) {
    await executor.execute(sql`
        UPDATE public.analysis_video_workers
        SET status = 'stopped', stopped_at = now(), updated_at = now()
        WHERE worker_id = ${workerId}
    `)
}

/** 延长当前尝试的租约；任何已过期或已换主的租约都不能复活。 */
export async function heartbeatVideoLease(
    workerId: string,
    assetId: string,
    leaseMs: number,
    executor: DatabaseExecutor = db,
) {
    const rows = await executor.execute<Record<string, unknown>>(sql`
        UPDATE public.analysis_video_processing_attempts attempt
        SET heartbeat_at = now(),
            lease_expires_at = now() + (${leaseMs} * interval '1 millisecond'),
            updated_at = now()
        FROM public.analysis_video_assets asset
        WHERE attempt.asset_id = asset.id
          AND attempt.attempt_number = asset.processing_attempt_count
          AND attempt.worker_id = ${workerId}
          AND attempt.state = 'processing'
          AND attempt.lease_expires_at > now()
          AND asset.id = ${assetId}::uuid
          AND asset.state = 'processing'
        RETURNING attempt.id
    `)
    return Boolean(rows[0])
}

/** 回收失去心跳的尝试：首次技术失败重新排队，第二次进入终态。 */
export async function recoverExpiredVideoLeases(executor: DatabaseExecutor = db) {
    const rows = await executor.execute<Record<string, unknown>>(sql`
        WITH expired AS (
            SELECT attempt.id, attempt.asset_id, attempt.attempt_number
            FROM public.analysis_video_processing_attempts attempt
            INNER JOIN public.analysis_video_assets asset
                ON asset.id = attempt.asset_id
               AND asset.processing_attempt_count = attempt.attempt_number
            WHERE attempt.state = 'processing'
              AND ${maintenanceClaimAllowedSql()}
              AND attempt.lease_expires_at <= now()
              AND asset.state = 'processing'
            FOR UPDATE OF attempt, asset SKIP LOCKED
        ), closed_attempts AS (
            UPDATE public.analysis_video_processing_attempts attempt
            SET state = 'technical_failed',
                failure_code = 'video_worker_lost',
                completed_at = now(),
                lease_expires_at = NULL,
                updated_at = now()
            FROM expired
            WHERE attempt.id = expired.id
            RETURNING expired.asset_id, expired.attempt_number
        ), released_events AS (
            UPDATE public.analysis_video_start_events event
            SET state = 'released',
                released_at = now(),
                release_reason = 'system_technical_failure',
                updated_at = now()
            FROM closed_attempts closed
            WHERE event.asset_id = closed.asset_id
              AND event.state = 'counted'
              AND closed.attempt_number >=
                  ${VIDEO_RULES.maximumProcessingAttempts}
            RETURNING event.id
        )
        UPDATE public.analysis_video_assets asset
        SET state = CASE
                WHEN closed.attempt_number < ${VIDEO_RULES.maximumProcessingAttempts}
                    THEN 'queued'
                ELSE 'technical_failed'
            END,
            next_attempt_at = CASE
                WHEN closed.attempt_number < ${VIDEO_RULES.maximumProcessingAttempts}
                    THEN now()
                ELSE NULL
            END,
            failure_code = 'video_worker_lost',
            updated_at = now()
        FROM closed_attempts closed
        WHERE asset.id = closed.asset_id
        RETURNING asset.id
    `)
    return rows.length
}

/** 通过 `SKIP LOCKED` 领取一条视频，并在同一事务创建尝试记录。 */
export async function claimNextVideoAsset(workerId: string, leaseMs: number) {
    return withTransaction(async (transaction) => {
        const rows = await transaction.execute<VideoAssetRow>(sql`
            WITH candidate AS (
                SELECT id
                FROM public.analysis_video_assets
                WHERE state = 'queued'
                  AND ${maintenanceClaimAllowedSql()}
                  AND (next_attempt_at IS NULL OR next_attempt_at <= now())
                ORDER BY queued_at, id
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            UPDATE public.analysis_video_assets asset
            SET state = 'processing',
                processing_attempt_count = asset.processing_attempt_count + 1,
                processing_started_at = COALESCE(asset.processing_started_at, now()),
                next_attempt_at = NULL,
                updated_at = now()
            FROM candidate
            WHERE asset.id = candidate.id
            RETURNING ${videoAssetSelection}
        `)
        const row = rows[0]
        if (!row) {
            return null
        }
        await transaction.execute(sql`
            INSERT INTO public.analysis_video_processing_attempts (
                id,
                asset_id,
                attempt_number,
                state,
                worker_id,
                lease_expires_at,
                heartbeat_at
            )
            VALUES (
                ${crypto.randomUUID()}::uuid,
                ${row.id}::uuid,
                ${Number(row.processingAttemptCount)},
                'processing',
                ${workerId},
                now() + (${leaseMs} * interval '1 millisecond'),
                now()
            )
        `)
        await transaction.execute(sql`
            INSERT INTO public.analysis_video_start_events (
                asset_id,
                user_id,
                state,
                started_at
            )
            VALUES (
                ${row.id}::uuid,
                ${row.userId}::uuid,
                'counted',
                now()
            )
            ON CONFLICT (asset_id) DO NOTHING
        `)
        return mapVideoAsset(row)
    })
}

/** 只允许当前租约持有者提交证据和推进 ready 状态。 */
export async function markVideoReady(
    assetId: string,
    workerId: string,
    evidence: ReadyVideoEvidence,
) {
    return withTransaction(async (transaction) => {
        const attempts = await transaction.execute<Record<string, unknown>>(sql`
            UPDATE public.analysis_video_processing_attempts attempt
            SET state = 'succeeded',
                completed_at = now(),
                lease_expires_at = NULL,
                updated_at = now()
            FROM public.analysis_video_assets asset
            WHERE attempt.asset_id = asset.id
              AND attempt.attempt_number = asset.processing_attempt_count
              AND attempt.worker_id = ${workerId}
              AND attempt.state = 'processing'
              AND attempt.lease_expires_at > now()
              AND asset.id = ${assetId}::uuid
              AND asset.state = 'processing'
            RETURNING attempt.id
        `)
        if (!attempts[0]) {
            return false
        }
        await transaction.execute(sql`
            INSERT INTO public.analysis_video_evidence_packages (
                id,
                asset_id,
                evidence_version,
                original_sha256,
                duration_ms,
                width,
                height,
                container,
                video_codec,
                has_audio,
                media_metadata,
                pipeline_version,
                pipeline_config_version,
                ffmpeg_version,
                manifest_object_path,
                generated_at,
                expires_at
            )
            VALUES (
                ${evidence.id}::uuid,
                ${assetId}::uuid,
                ${evidence.evidenceVersion},
                ${evidence.originalSha256},
                ${evidence.durationMs},
                ${evidence.width},
                ${evidence.height},
                ${evidence.container},
                ${evidence.videoCodec},
                ${evidence.hasAudio},
                ${JSON.stringify(evidence.mediaMetadata)}::jsonb,
                ${evidence.pipelineVersion},
                ${evidence.pipelineConfigVersion},
                ${evidence.ffmpegVersion},
                ${evidence.manifestObjectPath},
                ${evidence.generatedAt}::timestamptz,
                ${evidence.expiresAt}::timestamptz
            )
        `)
        const frameValues = sql.join(
            evidence.frames.map(
                (frame, position) => sql`(
                    ${crypto.randomUUID()}::uuid,
                    ${evidence.id}::uuid,
                    ${position},
                    ${frame.timestampMs},
                    ${frame.selectionReason},
                    ${frame.objectPath},
                    ${frame.sha256},
                    ${frame.width},
                    ${frame.height},
                    ${frame.byteSize},
                    ${frame.mediaType}
                )`,
            ),
            sql`, `,
        )
        await transaction.execute(sql`
            INSERT INTO public.analysis_video_evidence_frames (
                id,
                evidence_package_id,
                position,
                timestamp_ms,
                selection_reason,
                object_path,
                sha256,
                width,
                height,
                byte_size,
                media_type
            )
            VALUES ${frameValues}
        `)
        await transaction.execute(sql`
            UPDATE public.analysis_video_assets
            SET state = 'ready',
                evidence_id = ${evidence.id}::uuid,
                ready_at = now(),
                failure_code = NULL,
                failure_detail = NULL,
                updated_at = now()
            WHERE id = ${assetId}::uuid
              AND state = 'processing'
        `)
        return true
    })
}

/** 仅由有效租约持有者结束尝试；首次技术失败立即重排，确定性失败不重试。 */
export async function markVideoFailed(
    assetId: string,
    workerId: string,
    failure: VideoProcessingFailure,
): Promise<VideoFailureOutcome> {
    const attemptState =
        failure.kind === 'deterministic' ? 'deterministic_failed' : 'technical_failed'
    return withTransaction(async (transaction) => {
        const attempts = await transaction.execute<{
            attemptNumber: number | string
        }>(sql`
            UPDATE public.analysis_video_processing_attempts attempt
            SET state = ${attemptState},
                failure_code = ${failure.code},
                completed_at = now(),
                lease_expires_at = NULL,
                updated_at = now()
            FROM public.analysis_video_assets asset
            WHERE attempt.asset_id = asset.id
              AND attempt.attempt_number = asset.processing_attempt_count
              AND attempt.worker_id = ${workerId}
              AND attempt.state = 'processing'
              AND attempt.lease_expires_at > now()
              AND asset.id = ${assetId}::uuid
              AND asset.state = 'processing'
            RETURNING attempt.attempt_number AS "attemptNumber"
        `)
        const attempt = attempts[0]
        if (!attempt) {
            return 'stale'
        }
        const shouldRetry =
            failure.kind === 'technical' &&
            Number(attempt.attemptNumber) < VIDEO_RULES.maximumProcessingAttempts
        const assetState = shouldRetry ? 'queued' : attemptState
        await transaction.execute(sql`
            UPDATE public.analysis_video_assets
            SET state = ${assetState},
                next_attempt_at = CASE
                    WHEN ${shouldRetry} THEN now()
                    ELSE NULL
                END,
                failure_code = ${failure.code},
                updated_at = now()
            WHERE id = ${assetId}::uuid
              AND state = 'processing'
        `)
        if (!shouldRetry && failure.kind === 'technical') {
            await transaction.execute(sql`
                UPDATE public.analysis_video_start_events
                SET state = 'released',
                    released_at = now(),
                    release_reason = 'system_technical_failure',
                    updated_at = now()
                WHERE asset_id = ${assetId}::uuid
                  AND state = 'counted'
            `)
        }
        return shouldRetry ? 'retry_scheduled' : 'terminal'
    })
}

interface VideoOriginalCleanupRow extends Record<string, unknown> {
    assetId: string
    originalObjectPath: string
}

/** 独立领取一个终态视频的原文件清理租约。 */
export async function claimVideoOriginalCleanup(
    workerId: string,
    leaseMs: number,
    assetId?: string,
) {
    const assetFilter = assetId ? sql`AND asset.id = ${assetId}::uuid` : sql``
    return withTransaction(async (transaction) => {
        const rows = await transaction.execute<VideoOriginalCleanupRow>(sql`
            WITH candidate AS (
                SELECT asset.id
                FROM public.analysis_video_assets asset
                WHERE asset.state IN (
                    'ready',
                    'deterministic_failed',
                    'technical_failed',
                    'cancelled',
                    'expired'
                )
                  AND ${maintenanceClaimAllowedSql()}
                  AND asset.original_cleanup_attempt_count <
                      ${VIDEO_RULES.maximumOriginalCleanupAttempts}
                  AND (
                      asset.original_cleanup_state = 'retained'
                      OR (
                          asset.original_cleanup_state = 'cleanup_failed'
                          AND (
                              asset.original_cleanup_next_attempt_at IS NULL
                              OR asset.original_cleanup_next_attempt_at <= now()
                          )
                      )
                      OR (
                          asset.original_cleanup_state = 'deleting'
                          AND asset.original_cleanup_lease_expires_at <= now()
                      )
                  )
                  ${assetFilter}
                ORDER BY asset.updated_at, asset.id
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            UPDATE public.analysis_video_assets asset
            SET original_cleanup_state = 'deleting',
                original_cleanup_attempt_count =
                    asset.original_cleanup_attempt_count + 1,
                original_cleanup_next_attempt_at = NULL,
                original_cleanup_last_error_code = NULL,
                original_cleanup_worker_id = ${workerId},
                original_cleanup_lease_expires_at =
                    now() + (${leaseMs} * interval '1 millisecond'),
                updated_at = now()
            FROM candidate
            WHERE asset.id = candidate.id
            RETURNING
                asset.id::text AS "assetId",
                asset.original_object_path AS "originalObjectPath"
        `)
        return rows[0] ?? null
    })
}

/** 确认原视频对象已清理。 */
export async function completeVideoOriginalCleanup(
    assetId: string,
    workerId: string,
    executor: DatabaseExecutor = db,
) {
    const rows = await executor.execute<Record<string, unknown>>(sql`
        UPDATE public.analysis_video_assets
        SET original_cleanup_state = 'deleted',
            original_cleanup_worker_id = NULL,
            original_cleanup_lease_expires_at = NULL,
            original_cleanup_next_attempt_at = NULL,
            original_cleanup_last_error_code = NULL,
            original_deleted_at = now(),
            updated_at = now()
        WHERE id = ${assetId}::uuid
          AND original_cleanup_state = 'deleting'
          AND original_cleanup_worker_id = ${workerId}
          AND original_cleanup_lease_expires_at > now()
        RETURNING id
    `)
    return Boolean(rows[0])
}

/** 记录原视频对象清理失败并安排重试。 */
export async function failVideoOriginalCleanup(
    assetId: string,
    workerId: string,
    code: string,
    executor: DatabaseExecutor = db,
) {
    const rows = await executor.execute<Record<string, unknown>>(sql`
        UPDATE public.analysis_video_assets
        SET original_cleanup_state = 'cleanup_failed',
            original_cleanup_worker_id = NULL,
            original_cleanup_lease_expires_at = NULL,
            original_cleanup_next_attempt_at =
                now() + (${VIDEO_RULES.originalCleanupRetryMs} * interval '1 millisecond'),
            original_cleanup_last_error_code = ${code},
            updated_at = now()
        WHERE id = ${assetId}::uuid
          AND original_cleanup_state = 'deleting'
          AND original_cleanup_worker_id = ${workerId}
        RETURNING id
    `)
    return Boolean(rows[0])
}

/** 以短期租约领取一份到期证据，并返回清单与全部帧的私有对象路径。 */
export function claimVideoEvidenceCleanup(
    workerId: string,
    leaseMs: number,
): Promise<VideoEvidenceCleanupRecord | null> {
    return withTransaction(async (transaction) => {
        const packages = await transaction.execute<
            {
                evidenceId: string
                manifestObjectPath: string
            } & Record<string, unknown>
        >(sql`
            WITH candidate AS (
                SELECT evidence.id
                FROM public.analysis_video_evidence_packages AS evidence
                WHERE evidence.expires_at <= now()
                  AND ${maintenanceClaimAllowedSql()}
                  AND evidence.cleanup_attempt_count < ${VIDEO_RULES.maximumEvidenceCleanupAttempts}
                  AND evidence.cleanup_state IN ('retained', 'deleting', 'cleanup_failed')
                  AND (
                      evidence.cleanup_next_attempt_at IS NULL
                      OR evidence.cleanup_next_attempt_at <= now()
                  )
                  AND (
                      evidence.cleanup_state <> 'deleting'
                      OR evidence.cleanup_lease_expires_at IS NULL
                      OR evidence.cleanup_lease_expires_at <= now()
                  )
                  AND NOT EXISTS (
                      SELECT 1
                      FROM public.analysis_video_evidence_restore_sessions AS restore
                      WHERE restore.evidence_package_id = evidence.id
                        AND restore.state = 'issued'
                        AND restore.expires_at > now()
                  )
                ORDER BY evidence.expires_at, evidence.id
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            UPDATE public.analysis_video_evidence_packages AS evidence
            SET cleanup_state = 'deleting',
                cleanup_attempt_count = evidence.cleanup_attempt_count + 1,
                cleanup_next_attempt_at = NULL,
                cleanup_last_error_code = NULL,
                cleanup_worker_id = ${workerId},
                cleanup_lease_expires_at =
                    now() + (${leaseMs} * interval '1 millisecond'),
                updated_at = now()
            FROM candidate
            WHERE evidence.id = candidate.id
            RETURNING
                evidence.id::text AS "evidenceId",
                evidence.manifest_object_path AS "manifestObjectPath"
        `)
        const evidence = packages[0]
        if (!evidence) {
            return null
        }
        const frames = await transaction.execute<
            {
                objectPath: string
            } & Record<string, unknown>
        >(sql`
            SELECT object_path AS "objectPath"
            FROM public.analysis_video_evidence_frames
            WHERE evidence_package_id = ${evidence.evidenceId}::uuid
            ORDER BY position
        `)
        return {
            evidenceId: evidence.evidenceId,
            objectPaths: [evidence.manifestObjectPath, ...frames.map((frame) => frame.objectPath)],
        }
    })
}

/** Storage 删除成功后把证据与视频原子推进到过期终态。 */
export function completeVideoEvidenceCleanup(
    evidenceId: string,
    workerId: string,
): Promise<boolean> {
    return withTransaction(async (transaction) => {
        const rows = await transaction.execute<
            {
                assetId: string
            } & Record<string, unknown>
        >(sql`
            UPDATE public.analysis_video_evidence_packages
            SET cleanup_state = 'deleted',
                cleanup_worker_id = NULL,
                cleanup_lease_expires_at = NULL,
                cleanup_next_attempt_at = NULL,
                cleanup_last_error_code = NULL,
                deleted_at = now(),
                updated_at = now()
            WHERE id = ${evidenceId}::uuid
              AND cleanup_state = 'deleting'
              AND cleanup_worker_id = ${workerId}
              AND cleanup_lease_expires_at > now()
            RETURNING asset_id::text AS "assetId"
        `)
        const evidence = rows[0]
        if (!evidence) {
            return false
        }
        await transaction.execute(sql`
            UPDATE public.analysis_video_assets
            SET state = 'expired', updated_at = now()
            WHERE id = ${evidence.assetId}::uuid
              AND state = 'ready'
        `)
        return true
    })
}

/** Storage 临时失败时释放证据租约，并按集中退避间隔安排重试。 */
export async function failVideoEvidenceCleanup(
    evidenceId: string,
    workerId: string,
    code: string,
    executor: DatabaseExecutor = db,
) {
    const rows = await executor.execute<Record<string, unknown>>(sql`
        UPDATE public.analysis_video_evidence_packages
        SET cleanup_state = 'cleanup_failed',
            cleanup_worker_id = NULL,
            cleanup_lease_expires_at = NULL,
            cleanup_next_attempt_at =
                now() + (${VIDEO_RULES.evidenceCleanupRetryMs} * interval '1 millisecond'),
            cleanup_last_error_code = ${code},
            updated_at = now()
        WHERE id = ${evidenceId}::uuid
          AND cleanup_state = 'deleting'
          AND cleanup_worker_id = ${workerId}
        RETURNING id
    `)
    return Boolean(rows[0])
}

/** PostgreSQL 视频 Worker 持久化实现。 */
export const postgresVideoWorkerPersistence: VideoWorkerPersistence = {
    registerWorker: registerVideoWorker,
    heartbeatWorker: heartbeatVideoWorker,
    stopWorker: stopVideoWorker,
    recoverExpiredLeases: recoverExpiredVideoLeases,
    heartbeatLease: heartbeatVideoLease,
    claimNext: claimNextVideoAsset,
    markReady: markVideoReady,
    markFailed: markVideoFailed,
    claimOriginalCleanup: claimVideoOriginalCleanup,
    completeOriginalCleanup: completeVideoOriginalCleanup,
    failOriginalCleanup: failVideoOriginalCleanup,
    claimEvidenceCleanup: claimVideoEvidenceCleanup,
    completeEvidenceCleanup: completeVideoEvidenceCleanup,
    failEvidenceCleanup: failVideoEvidenceCleanup,
}
