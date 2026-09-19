import { sql } from 'drizzle-orm'

import { db, type DatabaseExecutor } from '../../db/database'

export interface AnalysisRollingUsageCall {
    startedAt: string
    tokenCount: number
}

export interface AnalysisRollingUsageRecord {
    databaseNow: string
    calls: AnalysisRollingUsageCall[]
}

/**
 * 读取账号在滚动窗口内的任务形成用量。统计起点同时受档位升级水位约束，
 * 正式分析和联网研究阶段不会进入结果。
 */
export async function readAnalysisRollingUsage(
    executor: DatabaseExecutor,
    userId: string,
    windowSeconds: number,
): Promise<AnalysisRollingUsageRecord> {
    const rows = await executor.execute<{
        startedAt: Date | string | null
        tokenCount: number | string | null
        databaseNow: Date | string
    }>(sql`
        WITH boundary AS (
            SELECT
                clock_timestamp() AS database_now,
                greatest(
                    clock_timestamp() - make_interval(secs => ${windowSeconds}),
                    coalesce(
                        (
                            SELECT rolling_usage_reset_at
                            FROM public.analysis_conversation_controls
                            WHERE user_id = ${userId}::uuid
                        ),
                        '-infinity'::timestamptz
                    )
                ) AS usage_started_after
        )
        SELECT
            usage_call.started_at AS "startedAt",
            usage_call.metered_tokens AS "tokenCount",
            boundary.database_now AS "databaseNow"
        FROM boundary
        LEFT JOIN LATERAL (
            SELECT started_at, metered_tokens
            FROM public.agent_usage_calls
            WHERE user_id = ${userId}::uuid
                AND stage = 'form_conversation_turn'
                AND status <> 'started'
                AND metered_tokens > 0
                AND started_at > boundary.usage_started_after
            ORDER BY started_at ASC, id ASC
        ) AS usage_call ON true
        ORDER BY usage_call.started_at ASC NULLS LAST
    `)
    const boundary = rows[0]
    if (!boundary) throw new Error('无法读取 Agent 滚动用量数据库时钟')
    return {
        databaseNow: new Date(boundary.databaseNow).toISOString(),
        calls: rows.flatMap((row) =>
            row.startedAt === null || row.tokenCount === null
                ? []
                : [
                      {
                          startedAt: new Date(row.startedAt).toISOString(),
                          tokenCount: Number(row.tokenCount),
                      },
                  ],
        ),
    }
}

/** 生产持久化适配器。 */
export function findAnalysisRollingUsage(userId: string, windowSeconds: number) {
    return readAnalysisRollingUsage(db, userId, windowSeconds)
}
