import { sql } from 'drizzle-orm'

import type { DatabaseExecutor } from '../../db/database'
import { analysisMediaUploadAdmissionRules } from '../analysis.constants'
import {
    decideAnalysisMediaUploadAdmission,
    type AnalysisMediaUploadRequest,
} from './analysis.media-upload-admission'

interface UploadCountRow extends Record<string, unknown> {
    imageCount: number | string
    videoCount: number | string
}

interface CancelledVideoRow extends Record<string, unknown> {
    id: string
    uploadSessionId: string
}

function identifiers(ids: readonly string[]) {
    return sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
    )
}

/**
 * 在上传会话插入前原子检查账号窗口；超限时提交全部未绑定草稿素材的失效状态。
 */
export async function admitAnalysisMediaUpload(
    executor: DatabaseExecutor,
    userId: string,
    request: AnalysisMediaUploadRequest,
) {
    await executor.execute(sql`
        SELECT pg_advisory_xact_lock(
            hashtextextended(${'analysis:media-upload:' + userId}::text, 0)
        )
    `)
    const rows = await executor.execute<UploadCountRow>(sql`
        SELECT
            (
                SELECT count(*)
                FROM public.analysis_assets AS asset
                WHERE asset.user_id = ${userId}::uuid
                  AND asset.created_at >
                      now() - (${analysisMediaUploadAdmissionRules.windowMs} * interval '1 millisecond')
            ) AS "imageCount",
            (
                SELECT count(*)
                FROM public.analysis_video_assets AS asset
                WHERE asset.user_id = ${userId}::uuid
                  AND asset.created_at >
                      now() - (${analysisMediaUploadAdmissionRules.windowMs} * interval '1 millisecond')
            ) AS "videoCount"
    `)
    const counts = rows[0] ?? { imageCount: 0, videoCount: 0 }
    const decision = decideAnalysisMediaUploadAdmission(
        {
            imageCount: Number(counts.imageCount),
            videoCount: Number(counts.videoCount),
        },
        request,
    )
    if (decision.admitted) return decision

    await executor.execute(sql`
        UPDATE public.analysis_assets
        SET cleanup_requested_at = COALESCE(cleanup_requested_at, now())
        WHERE user_id = ${userId}::uuid
          AND task_id IS NULL
          AND state NOT IN ('deleted', 'deleting')
    `)
    const cancelledVideos = await executor.execute<CancelledVideoRow>(sql`
        UPDATE public.analysis_video_assets AS asset
        SET state = 'cancelled',
            cancellation_requested_at = COALESCE(cancellation_requested_at, now()),
            next_attempt_at = NULL,
            failure_code = 'upload_rate_limited',
            failure_detail = NULL,
            updated_at = now()
        WHERE asset.user_id = ${userId}::uuid
          AND asset.state IN (
              'awaiting_upload',
              'uploaded',
              'queued',
              'processing',
              'ready',
              'deterministic_failed',
              'technical_failed'
          )
          AND NOT EXISTS (
              SELECT 1
              FROM public.analysis_tasks AS task
              WHERE task.user_id = asset.user_id
                AND task.standard_task_snapshot -> 'videoEvidence' ->> 'assetId' = asset.id::text
          )
        RETURNING
            asset.id::text AS id,
            asset.upload_session_id::text AS "uploadSessionId"
    `)
    if (cancelledVideos.length > 0) {
        const videoIds = cancelledVideos.map((video) => video.id)
        const sessionIds = cancelledVideos.map((video) => video.uploadSessionId)
        await executor.execute(sql`
            UPDATE public.analysis_video_processing_attempts
            SET state = 'cancelled',
                failure_code = 'video_cancelled',
                completed_at = now(),
                lease_expires_at = NULL,
                updated_at = now()
            WHERE asset_id IN (${identifiers(videoIds)})
              AND state = 'processing'
        `)
        await executor.execute(sql`
            UPDATE public.analysis_video_upload_sessions
            SET state = 'cancelled', updated_at = now()
            WHERE id IN (${identifiers(sessionIds)})
              AND user_id = ${userId}::uuid
        `)
    }
    return decision
}
