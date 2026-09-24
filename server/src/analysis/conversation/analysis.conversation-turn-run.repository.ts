import { sql } from 'drizzle-orm'

import { db, type DatabaseExecutor } from '../../db/database'
import { resolveAnalysisConversationTurnLeaseSeconds } from '../analysis.constants'
import type { AnalysisConversationTurnResult } from './analysis.conversation.contract'

export type AnalysisConversationTurnRunStatus =
    | 'processing'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'acknowledged'

export type AnalysisConversationTurnFailureReason =
    | 'turn_failed'
    | 'server_restarted'
    | 'conversation_cleared'
    | 'logged_out'

export interface AnalysisConversationTurnRunIdentity {
    userId: string
    turnId: string
    sessionId: string
    generation: number
    browserInstanceId: string
}

export interface AnalysisConversationTurnRunRecord extends AnalysisConversationTurnRunIdentity {
    status: AnalysisConversationTurnRunStatus
    resultPayload: unknown
    failureReason: AnalysisConversationTurnFailureReason | null
    processingExpiresAt: string
}

/** 注销墓碑在账号锁内判定，旧认证会话不能晚到后重新创建回合。 */
export async function isAnalysisConversationAuthSessionBlocked(
    executor: DatabaseExecutor,
    userId: string,
    authSessionKey: string,
) {
    const rows = await executor.execute<{ blocked: boolean }>(sql`
        SELECT TRUE AS blocked
        FROM public.analysis_conversation_logout_sessions
        WHERE user_id = ${userId}::uuid
          AND auth_session_key = ${authSessionKey}
          AND expires_at > clock_timestamp()
        LIMIT 1
    `)
    return Boolean(rows[0]?.blocked)
}

/** 同一认证会话重复注销只延长同一墓碑，不保存 access/refresh token。 */
export async function blockAnalysisConversationAuthSession(
    executor: DatabaseExecutor,
    userId: string,
    authSessionKey: string,
) {
    await executor.execute(sql`
        INSERT INTO public.analysis_conversation_logout_sessions (
            user_id,
            auth_session_key
        )
        VALUES (${userId}::uuid, ${authSessionKey})
        ON CONFLICT (user_id, auth_session_key) DO UPDATE
        SET logged_out_at = clock_timestamp(),
            expires_at = clock_timestamp() + INTERVAL '24 hours'
    `)
}

interface TurnRunRow extends Record<string, unknown> {
    id: string
    userId: string
    sessionId: string
    generation: number | string
    browserInstanceId: string
    status: AnalysisConversationTurnRunStatus
    resultPayload: unknown
    failureReason: AnalysisConversationTurnFailureReason | null
    processingExpiresAt: Date | string
}

const turnRunSelection = sql`
    id::text AS id,
    user_id::text AS "userId",
    session_id::text AS "sessionId",
    generation,
    browser_instance_id::text AS "browserInstanceId",
    status,
    result_payload AS "resultPayload",
    failure_reason AS "failureReason",
    processing_expires_at AS "processingExpiresAt"
`

function toIso(value: Date | string) {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function mapTurnRun(row: TurnRunRow): AnalysisConversationTurnRunRecord {
    return {
        userId: row.userId,
        turnId: row.id,
        sessionId: row.sessionId,
        generation: Number(row.generation),
        browserInstanceId: row.browserInstanceId,
        status: row.status,
        resultPayload: row.resultPayload,
        failureReason: row.failureReason,
        processingExpiresAt: toIso(row.processingExpiresAt),
    }
}

async function failExpiredProcessingTurnRuns(executor: DatabaseExecutor, userId: string) {
    await executor.execute(sql`
        UPDATE public.analysis_conversation_turn_runs
        SET status = 'failed',
            failure_reason = 'server_restarted',
            completed_at = clock_timestamp(),
            updated_at = clock_timestamp()
        WHERE user_id = ${userId}::uuid
          AND status = 'processing'
          AND processing_expires_at <= clock_timestamp()
    `)
}

/** 新建或读取同一个幂等回合；不保存请求正文。 */
export async function beginAnalysisConversationTurnRun(
    executor: DatabaseExecutor,
    input: AnalysisConversationTurnRunIdentity,
) {
    await failExpiredProcessingTurnRuns(executor, input.userId)
    const inserted = await executor.execute<{ id: string }>(sql`
        INSERT INTO public.analysis_conversation_turn_runs (
            id,
            user_id,
            session_id,
            generation,
            browser_instance_id,
            processing_expires_at
        )
        VALUES (
            ${input.turnId}::uuid,
            ${input.userId}::uuid,
            ${input.sessionId}::uuid,
            ${input.generation},
            ${input.browserInstanceId}::uuid,
            clock_timestamp() + make_interval(
                secs => ${resolveAnalysisConversationTurnLeaseSeconds()}
            )
        )
        ON CONFLICT DO NOTHING
        RETURNING id::text AS id
    `)
    const rows = await executor.execute<TurnRunRow>(sql`
        SELECT ${turnRunSelection}
        FROM public.analysis_conversation_turn_runs
        WHERE id = ${input.turnId}::uuid
          AND user_id = ${input.userId}::uuid
          AND session_id = ${input.sessionId}::uuid
          AND generation = ${input.generation}
          AND browser_instance_id = ${input.browserInstanceId}::uuid
          AND expires_at > clock_timestamp()
        LIMIT 1
    `)
    const row = rows[0]
    if (row) return { ...mapTurnRun(row), created: inserted.length > 0 }
    const activeRows = await executor.execute<TurnRunRow>(sql`
        SELECT ${turnRunSelection}
        FROM public.analysis_conversation_turn_runs
        WHERE user_id = ${input.userId}::uuid
          AND status = 'processing'
          AND processing_expires_at > clock_timestamp()
        LIMIT 1
    `)
    return activeRows[0] ? { ...mapTurnRun(activeRows[0]), created: false } : null
}

/** 权威控制租约取得后重新对齐 mailbox 租约起点，覆盖完整 Provider 窗口。 */
export async function renewAnalysisConversationTurnRun(
    executor: DatabaseExecutor,
    input: AnalysisConversationTurnRunIdentity,
) {
    const rows = await executor.execute<{ id: string }>(sql`
        UPDATE public.analysis_conversation_turn_runs
        SET processing_expires_at = LEAST(
                expires_at,
                clock_timestamp() + make_interval(
                    secs => ${resolveAnalysisConversationTurnLeaseSeconds()}
                )
            ),
            updated_at = clock_timestamp()
        WHERE id = ${input.turnId}::uuid
          AND user_id = ${input.userId}::uuid
          AND session_id = ${input.sessionId}::uuid
          AND generation = ${input.generation}
          AND browser_instance_id = ${input.browserInstanceId}::uuid
          AND status = 'processing'
          AND processing_expires_at > clock_timestamp()
          AND expires_at > clock_timestamp()
        RETURNING id::text AS id
    `)
    return Boolean(rows[0])
}

/** 保存仍由同一浏览器会话持有的完整回合结果。 */
export async function completeAnalysisConversationTurnRun(
    executor: DatabaseExecutor,
    input: AnalysisConversationTurnRunIdentity,
    result: AnalysisConversationTurnResult,
) {
    const serializedResult = JSON.stringify(result)
    const rows = await executor.execute<{ id: string }>(sql`
        UPDATE public.analysis_conversation_turn_runs
        SET status = 'completed',
            result_payload = ${serializedResult}::jsonb,
            completed_at = clock_timestamp(),
            updated_at = clock_timestamp()
        WHERE id = ${input.turnId}::uuid
          AND user_id = ${input.userId}::uuid
          AND session_id = ${input.sessionId}::uuid
          AND generation = ${input.generation}
          AND browser_instance_id = ${input.browserInstanceId}::uuid
          AND status = 'processing'
          AND processing_expires_at > clock_timestamp()
        RETURNING id::text AS id
    `)
    return Boolean(rows[0])
}

/** 失败只写稳定原因，不保存异常正文。 */
export async function failAnalysisConversationTurnRun(
    executor: DatabaseExecutor,
    input: AnalysisConversationTurnRunIdentity,
) {
    await executor.execute(sql`
        UPDATE public.analysis_conversation_turn_runs
        SET status = 'failed',
            failure_reason = 'turn_failed',
            completed_at = clock_timestamp(),
            updated_at = clock_timestamp()
        WHERE id = ${input.turnId}::uuid
          AND user_id = ${input.userId}::uuid
          AND status = 'processing'
    `)
}

/** 按账号、浏览器和会话精确恢复一轮临时结果。 */
export async function findAnalysisConversationTurnRun(
    executor: DatabaseExecutor,
    input: AnalysisConversationTurnRunIdentity,
) {
    await failExpiredProcessingTurnRuns(executor, input.userId)
    const rows = await executor.execute<TurnRunRow>(sql`
        SELECT ${turnRunSelection}
        FROM public.analysis_conversation_turn_runs
        WHERE id = ${input.turnId}::uuid
          AND user_id = ${input.userId}::uuid
          AND session_id = ${input.sessionId}::uuid
          AND generation = ${input.generation}
          AND browser_instance_id = ${input.browserInstanceId}::uuid
          AND expires_at > clock_timestamp()
        LIMIT 1
    `)
    return rows[0] ? mapTurnRun(rows[0]) : null
}

/** 浏览器完成本地落盘后清除云端结果，只保留幂等墓碑。 */
export async function acknowledgeAnalysisConversationTurnRun(
    executor: DatabaseExecutor,
    input: AnalysisConversationTurnRunIdentity,
) {
    const rows = await executor.execute<{ id: string }>(sql`
        UPDATE public.analysis_conversation_turn_runs
        SET status = 'acknowledged',
            result_payload = NULL,
            acknowledged_at = clock_timestamp(),
            updated_at = clock_timestamp()
        WHERE id = ${input.turnId}::uuid
          AND user_id = ${input.userId}::uuid
          AND session_id = ${input.sessionId}::uuid
          AND generation = ${input.generation}
          AND browser_instance_id = ${input.browserInstanceId}::uuid
          AND status = 'completed'
        RETURNING id::text AS id
    `)
    return Boolean(rows[0])
}

/** 清空会话或退出账号时使迟到结果永久失效。 */
export async function invalidateAnalysisConversationTurnRuns(
    executor: DatabaseExecutor,
    input: {
        userId: string
        reason: Extract<
            AnalysisConversationTurnFailureReason,
            'conversation_cleared' | 'logged_out'
        >
        sessionId?: string
        generation?: number
        browserInstanceId?: string
    },
) {
    const sessionFilter = input.sessionId
        ? sql`AND session_id = ${input.sessionId}::uuid
              AND generation = ${input.generation}
              AND browser_instance_id = ${input.browserInstanceId}::uuid`
        : sql``
    const rows = await executor.execute<{ id: string }>(sql`
        UPDATE public.analysis_conversation_turn_runs
        SET status = 'cancelled',
            result_payload = NULL,
            failure_reason = ${input.reason},
            completed_at = COALESCE(completed_at, clock_timestamp()),
            updated_at = clock_timestamp()
        WHERE user_id = ${input.userId}::uuid
          ${sessionFilter}
          AND status IN ('processing', 'completed')
        RETURNING id::text AS id
    `)
    return rows.length
}

export const analysisConversationTurnRunRepository = {
    begin: (input: AnalysisConversationTurnRunIdentity) =>
        beginAnalysisConversationTurnRun(db, input),
    beginInTransaction: (
        executor: DatabaseExecutor,
        input: AnalysisConversationTurnRunIdentity,
        authSessionKey: string,
    ) =>
        isAnalysisConversationAuthSessionBlocked(executor, input.userId, authSessionKey).then(
            (blocked) => (blocked ? null : beginAnalysisConversationTurnRun(executor, input)),
        ),
    complete: (
        input: AnalysisConversationTurnRunIdentity,
        result: AnalysisConversationTurnResult,
    ) => completeAnalysisConversationTurnRun(db, input, result),
    completeInTransaction: (
        executor: DatabaseExecutor,
        input: AnalysisConversationTurnRunIdentity,
        result: AnalysisConversationTurnResult,
    ) => completeAnalysisConversationTurnRun(executor, input, result),
    renew: (input: AnalysisConversationTurnRunIdentity) =>
        renewAnalysisConversationTurnRun(db, input),
    fail: (input: AnalysisConversationTurnRunIdentity) =>
        failAnalysisConversationTurnRun(db, input),
    find: (input: AnalysisConversationTurnRunIdentity) =>
        findAnalysisConversationTurnRun(db, input),
    acknowledge: (input: AnalysisConversationTurnRunIdentity) =>
        acknowledgeAnalysisConversationTurnRun(db, input),
    invalidate: (input: Parameters<typeof invalidateAnalysisConversationTurnRuns>[1]) =>
        invalidateAnalysisConversationTurnRuns(db, input),
    invalidateInTransaction: (
        executor: DatabaseExecutor,
        input: Parameters<typeof invalidateAnalysisConversationTurnRuns>[1],
    ) => invalidateAnalysisConversationTurnRuns(executor, input),
    blockAuthSession: (executor: DatabaseExecutor, userId: string, authSessionKey: string) =>
        blockAnalysisConversationAuthSession(executor, userId, authSessionKey),
}
