import { sql } from 'drizzle-orm'

import { db } from '../../db/database'

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

/** 记录提前清理意图；实际删除由 PostgreSQL 每日定时任务统一执行。 */
export async function requestAnalysisAssetCleanup(filter: AnalysisAssetCleanupFilter) {
    const rows = filter.taskId
        ? await db.execute<{ id: string }>(sql`
              UPDATE public.analysis_assets
              SET cleanup_requested_at = COALESCE(cleanup_requested_at, now())
              WHERE user_id = ${filter.userId}::uuid
                  AND task_id = ${filter.taskId}::uuid
                  AND state NOT IN ('deleted', 'deleting')
              RETURNING id::text AS id
          `)
        : await db.execute<{ id: string }>(sql`
              UPDATE public.analysis_assets
              SET cleanup_requested_at = COALESCE(cleanup_requested_at, now())
              WHERE user_id = ${filter.userId}::uuid
                  AND state NOT IN ('deleted', 'deleting')
              RETURNING id::text AS id
          `)

    return rows.length
}

/** 请求现有受保护 Edge Function 尽快消费图片清理队列。 */
export async function invokeAnalysisMediaCleanup() {
    await db.execute(sql`SELECT public.invoke_analysis_media_cleanup()`)
}
