import { sql, type SQL } from 'drizzle-orm'

/** 待准备引用与已冻结证据都属于活动任务；所有查询同时约束账号归属。 */
export function activeVideoTaskExistsSql(assetId: SQL, userId: SQL, excludedTaskId?: string): SQL {
    return sql`EXISTS (
        SELECT 1 FROM public.analysis_tasks AS task
        WHERE task.user_id = ${userId}
            ${excludedTaskId ? sql`AND task.id <> ${excludedTaskId}::uuid` : sql``}
            AND task.status IN ('researching', 'queued', 'processing', 'retrying')
            AND (
                task.standard_task_snapshot #>> '{videoEvidence,assetId}' = ${assetId}::text
                OR task.standard_task_snapshot #>> '{mediaPreparation,videoReference}' = ${assetId}::text
            )
    )`
}
