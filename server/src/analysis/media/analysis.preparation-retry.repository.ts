import { sql } from 'drizzle-orm'

import type { DatabaseExecutor } from '../../db/database'
import { activeVideoTaskExistsSql } from '../../video/video.task-protection'
import { AnalysisAssetExpiredError, AnalysisVideoEvidenceExpiredError } from '../analysis.errors'
import type { StandardAnalysisTask } from '../analysis.schema'

function identifiers(ids: readonly string[]) {
    return sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
    )
}

async function resetImages(
    executor: DatabaseExecutor,
    userId: string,
    taskId: string,
    imageIds: readonly string[],
): Promise<void> {
    if (imageIds.length === 0) return
    await executor.execute(sql`
        SELECT id FROM public.analysis_assets
        WHERE user_id = ${userId}::uuid AND id IN (${identifiers(imageIds)})
        ORDER BY id FOR UPDATE
    `)
    const rows = await executor.execute<{ id: string }>(sql`
        SELECT asset.id FROM public.analysis_assets AS asset
        WHERE asset.user_id = ${userId}::uuid AND asset.id IN (${identifiers(imageIds)})
            AND asset.expires_at > now() AND asset.cleanup_requested_at IS NULL
            AND asset.state IN ('uploaded', 'processing', 'ready', 'failed')
            AND NOT EXISTS (
                SELECT 1 FROM public.analysis_tasks AS task
                WHERE task.id = asset.task_id AND task.id <> ${taskId}::uuid
                    AND task.status IN ('researching', 'queued', 'processing', 'retrying')
            )
    `)
    if (rows.length !== imageIds.length) {
        throw new AnalysisAssetExpiredError('图片原件不可用或已被其他任务使用，请重新上传')
    }
    for (const [position, imageId] of imageIds.entries()) {
        await executor.execute(sql`
            UPDATE public.analysis_assets
            SET task_id = ${taskId}::uuid, position = ${position},
                processing_cycle_start_attempt = CASE WHEN state = 'failed'
                    THEN processing_attempt_count ELSE processing_cycle_start_attempt END,
                failure_code = CASE WHEN state = 'failed' THEN NULL ELSE failure_code END,
                state = CASE WHEN state = 'failed' THEN 'uploaded' ELSE state END
            WHERE id = ${imageId}::uuid AND user_id = ${userId}::uuid
        `)
    }
}

async function resetVideo(
    executor: DatabaseExecutor,
    userId: string,
    taskId: string,
    videoId: string,
): Promise<void> {
    await executor.execute(sql`
        SELECT id FROM public.analysis_video_assets
        WHERE id = ${videoId}::uuid AND user_id = ${userId}::uuid
        FOR UPDATE
    `)
    await executor.execute(sql`
        SELECT id FROM public.analysis_video_evidence_packages
        WHERE asset_id = ${videoId}::uuid
        FOR SHARE
    `)
    const rows = await executor.execute<{ id: string }>(sql`
        SELECT asset.id FROM public.analysis_video_assets AS asset
        WHERE asset.id = ${videoId}::uuid AND asset.user_id = ${userId}::uuid
            AND NOT ${activeVideoTaskExistsSql(sql`asset.id`, sql`asset.user_id`, taskId)}
            AND (
                (asset.state IN ('queued', 'processing', 'deterministic_failed', 'technical_failed')
                    AND asset.original_cleanup_state = 'retained')
                OR (asset.state = 'ready' AND EXISTS (
                    SELECT 1 FROM public.analysis_video_evidence_packages AS evidence
                    WHERE evidence.id = asset.evidence_id AND evidence.asset_id = asset.id
                        AND evidence.cleanup_state = 'retained' AND evidence.expires_at > now()
                ))
            )
    `)
    if (rows.length !== 1) {
        throw new AnalysisVideoEvidenceExpiredError('视频原件或证据不可用，请重新上传视频')
    }
    await executor.execute(sql`
        UPDATE public.analysis_video_assets
        SET processing_cycle_start_attempt = processing_attempt_count, state = 'queued',
            next_attempt_at = now(), failure_code = NULL, failure_detail = NULL,
            processing_started_at = NULL, updated_at = now()
        WHERE id = ${videoId}::uuid AND user_id = ${userId}::uuid
            AND state IN ('deterministic_failed', 'technical_failed')
    `)
}

/** 用户明确重试时开启新的两次准备预算，保留累计尝试号和原有尝试历史。 */
export async function resetFailedPreparationMedia(
    executor: DatabaseExecutor,
    userId: string,
    taskId: string,
    standardTask: Pick<
        StandardAnalysisTask,
        'imageReferences' | 'coverReference' | 'mediaPreparation'
    >,
): Promise<void> {
    const imageIds = [
        ...new Set([
            ...standardTask.imageReferences,
            ...(standardTask.coverReference ? [standardTask.coverReference] : []),
        ]),
    ]
    await resetImages(executor, userId, taskId, imageIds)
    const videoId = standardTask.mediaPreparation?.videoReference
    if (videoId) await resetVideo(executor, userId, taskId, videoId)
}
