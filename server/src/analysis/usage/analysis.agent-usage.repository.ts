import { sql } from 'drizzle-orm'

import { db, type DatabaseExecutor } from '../../db/database'
import type {
    AgentUsageCallStartRecord,
    AgentUsageCallTerminalRecord,
} from './analysis.agent-usage.contract'

interface AgentPromptCacheSummaryRow extends Record<string, unknown> {
    stage: string
    model: string | null
    promptVersion: string
    totalCalls: number | string
    observableCalls: number | string
    cacheHitCalls: number | string
    observedInputTokens: number | string
    cachedInputTokens: number | string
    firstAverageDurationMs: number | string | null
    repeatedAverageDurationMs: number | string | null
}

export interface AgentPromptCacheSummary {
    stage: string
    model: string | null
    promptVersion: string
    totalCalls: number
    observableCalls: number
    cacheHitCalls: number
    cacheFieldCoverage: number | null
    cacheHitRate: number | null
    cachedInputRatio: number | null
    firstAverageDurationMs: number | null
    repeatedAverageDurationMs: number | null
}

function ratio(numerator: number, denominator: number): number | null {
    return denominator > 0 ? numerator / denominator : null
}

/** 汇总自动 Prompt Caching 可观测覆盖、命中和同边界首次/后续耗时。 */
export async function findAgentPromptCacheSummaries(
    executor: DatabaseExecutor,
    fromInclusive: string,
    toExclusive: string,
): Promise<AgentPromptCacheSummary[]> {
    const rows = await executor.execute<AgentPromptCacheSummaryRow>(sql`
        WITH cache_calls AS (
            SELECT
                stage,
                model,
                prompt_version,
                input_tokens,
                cached_input_tokens,
                duration_ms,
                row_number() OVER (
                    PARTITION BY input_diagnostics ->> 'cacheBoundaryFingerprint'
                    ORDER BY started_at, id
                ) AS boundary_call_number
            FROM public.agent_usage_calls
            WHERE started_at >= ${fromInclusive}::timestamptz
              AND started_at < ${toExclusive}::timestamptz
              AND status = 'succeeded'
              AND input_diagnostics IS NOT NULL
        )
        SELECT
            stage,
            model,
            prompt_version AS "promptVersion",
            count(*)::bigint::text AS "totalCalls",
            count(cached_input_tokens)::bigint::text AS "observableCalls",
            count(*) FILTER (
                WHERE cached_input_tokens > 0
            )::bigint::text AS "cacheHitCalls",
            coalesce(sum(input_tokens) FILTER (
                WHERE cached_input_tokens IS NOT NULL
            ), 0)::bigint::text AS "observedInputTokens",
            coalesce(sum(cached_input_tokens), 0)::bigint::text AS "cachedInputTokens",
            round(avg(duration_ms) FILTER (
                WHERE boundary_call_number = 1
            ))::bigint::text AS "firstAverageDurationMs",
            round(avg(duration_ms) FILTER (
                WHERE boundary_call_number > 1
            ))::bigint::text AS "repeatedAverageDurationMs"
        FROM cache_calls
        GROUP BY stage, model, prompt_version
        ORDER BY stage, model NULLS FIRST, prompt_version
    `)
    return rows.map((row) => {
        const totalCalls = Number(row.totalCalls)
        const observableCalls = Number(row.observableCalls)
        const cacheHitCalls = Number(row.cacheHitCalls)
        const observedInputTokens = Number(row.observedInputTokens)
        const cachedInputTokens = Number(row.cachedInputTokens)
        return {
            stage: row.stage,
            model: row.model,
            promptVersion: row.promptVersion,
            totalCalls,
            observableCalls,
            cacheHitCalls,
            cacheFieldCoverage: ratio(observableCalls, totalCalls),
            cacheHitRate: ratio(cacheHitCalls, observableCalls),
            cachedInputRatio: ratio(cachedInputTokens, observedInputTokens),
            firstAverageDurationMs:
                row.firstAverageDurationMs === null ? null : Number(row.firstAverageDurationMs),
            repeatedAverageDurationMs:
                row.repeatedAverageDurationMs === null
                    ? null
                    : Number(row.repeatedAverageDurationMs),
        }
    })
}

/** 在真实 Provider 调用前创建一条不可合并的内部用量生命周期记录。 */
export async function insertAgentUsageCall(
    record: AgentUsageCallStartRecord,
    executor: DatabaseExecutor = db,
) {
    await executor.execute(sql`
        INSERT INTO public.agent_usage_calls (
            id,
            user_id,
            association_kind,
            association_id,
            task_id,
            provider_request_id,
            stage,
            provider,
            model,
            provider_version,
            prompt_version,
            attempt_number,
            image_input_count,
            video_frame_input_count,
            price_snapshot,
            started_at
        )
        VALUES (
            ${record.id}::uuid,
            ${record.userId}::uuid,
            ${record.associationKind},
            ${record.associationId}::uuid,
            ${record.taskId}::uuid,
            ${record.requestId}::uuid,
            ${record.stage},
            ${record.provider},
            ${record.model},
            ${record.providerVersion},
            ${record.promptVersion},
            ${record.attemptNumber},
            ${record.imageInputCount},
            ${record.videoFrameInputCount},
            ${JSON.stringify(record.priceSnapshot)}::jsonb,
            ${record.startedAt}::timestamptz
        )
    `)
}

/** 以一次条件更新结算成功、技术失败或取消的调用。 */
export async function settleAgentUsageCall(
    record: AgentUsageCallTerminalRecord,
    executor: DatabaseExecutor = db,
) {
    const usage = record.usage
    const updated = await executor.execute<{ id: string }>(sql`
        UPDATE public.agent_usage_calls
        SET
            status = ${record.status},
            error_category = ${record.errorCategory},
            retry_scheduled = ${record.retryScheduled},
            execution_id = ${record.executionId},
            input_tokens = ${usage?.inputTokens ?? null},
            text_input_tokens = ${usage?.textInputTokens ?? null},
            image_input_tokens = ${usage?.imageInputTokens ?? null},
            cached_input_tokens = ${usage?.cachedInputTokens ?? null},
            reasoning_tokens = ${usage?.reasoningTokens ?? null},
            output_tokens = ${usage?.outputTokens ?? null},
            total_tokens = ${usage?.totalTokens ?? null},
            input_diagnostics = ${record.inputDiagnostics ? JSON.stringify(record.inputDiagnostics) : null}::jsonb,
            metered_tokens = ${record.meteredTokens},
            estimated_cost_microusd = ${record.estimatedCostMicrousd},
            completed_at = ${record.completedAt}::timestamptz,
            duration_ms = ${record.durationMs},
            updated_at = clock_timestamp()
        WHERE id = ${record.id}::uuid
            AND status = 'started'
        RETURNING id
    `)
    if (!updated[0]) {
        throw new Error('Agent 使用量调用不存在或已结算')
    }
}
