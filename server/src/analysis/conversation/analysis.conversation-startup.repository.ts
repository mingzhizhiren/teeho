import { sql } from 'drizzle-orm'
import { db, type DatabaseExecutor } from '../../db/database'

/** 单 API 启动恢复统计；只统计聊天回合及其控制锁。 */
export interface ConversationStartupRecovery {
    interruptedTurns: number
    releasedControls: number
}

/** 仅在唯一 API 进程接受请求前调用，原子终止旧进程遗留的聊天执行。 */
export async function interruptPreviousConversationTurns(
    executor: DatabaseExecutor = db,
): Promise<ConversationStartupRecovery> {
    const rows = await executor.execute<{
        interruptedTurns: number | string
        releasedControls: number | string
    }>(sql`
        WITH interrupted AS (
            UPDATE public.analysis_conversation_turn_runs
            SET status = 'failed', failure_reason = 'server_restarted',
                completed_at = clock_timestamp(), updated_at = clock_timestamp()
            WHERE status = 'processing'
            RETURNING id
        ), released AS (
            UPDATE public.analysis_conversation_controls
            SET status = 'active', lease_id = NULL, lease_expires_at = NULL,
                updated_at = clock_timestamp()
            WHERE status = 'processing'
            RETURNING user_id
        )
        SELECT (SELECT count(*) FROM interrupted) AS "interruptedTurns",
               (SELECT count(*) FROM released) AS "releasedControls"
    `)
    if (!rows[0]) throw new Error('Conversation startup recovery returned no result')
    return {
        interruptedTurns: Number(rows[0].interruptedTurns),
        releasedControls: Number(rows[0].releasedControls),
    }
}
