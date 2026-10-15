import { sql } from 'drizzle-orm'

import { db, type DatabaseExecutor } from '../../db/database'

interface AnalysisAssetCleanupFilter {
    userId: string
    taskId?: string
}

/** 读取任务绑定图片的原始对象键；派生图继续支持结果重新生成。 */
export async function findAnalysisTaskOriginalObjectPaths(
    filter: Required<AnalysisAssetCleanupFilter>,
) {
    const rows = await db.execute<{ originalObjectPath: string }>(sql`
        SELECT original_object_path AS "originalObjectPath"
        FROM public.analysis_assets
        WHERE user_id = ${filter.userId}::uuid
          AND task_id = ${filter.taskId}::uuid
          AND state NOT IN ('deleted', 'deleting')
    `)
    return rows.map((row) => row.originalObjectPath)
}

/** 调用方事务内锁定素材后登记清理，活动任务的素材连清理意图也不得写入。 */
export async function requestAnalysisAssetCleanup(
    filter: AnalysisAssetCleanupFilter,
    executor: DatabaseExecutor,
): Promise<number> {
    const taskFilter = filter.taskId ? sql`AND task_id = ${filter.taskId}::uuid` : sql``
    const lockedAssets = await executor.execute<{ id: string }>(sql`
        SELECT id FROM public.analysis_assets
        WHERE user_id = ${filter.userId}::uuid
            ${taskFilter}
            AND state NOT IN ('deleted', 'deleting')
        ORDER BY id
        FOR UPDATE
    `)
    if (lockedAssets.length === 0) return 0
    const lockedIds = lockedAssets.map((asset) => asset.id)
    const rows = await executor.execute<{ id: string }>(sql`
        UPDATE public.analysis_assets AS asset
        SET cleanup_requested_at = COALESCE(cleanup_requested_at, now())
        WHERE user_id = ${filter.userId}::uuid
            ${taskFilter}
            AND id = ANY(${sql.param(lockedIds)}::uuid[])
            AND state NOT IN ('deleted', 'deleting')
            AND NOT EXISTS (
                SELECT 1 FROM public.analysis_tasks AS task
                WHERE task.id = asset.task_id AND task.user_id = asset.user_id
                    AND task.status IN ('researching', 'queued', 'processing', 'retrying')
            )
        RETURNING id::text AS id
    `)
    return rows.length
}

/** 请求现有受保护 Edge Function 尽快消费图片清理队列。 */
export async function invokeAnalysisMediaCleanup() {
    await db.execute(sql`SELECT public.invoke_analysis_media_cleanup()`)
}
