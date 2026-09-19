import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'

import {
    findAgentPromptCacheSummaries,
    settleAgentUsageCall,
} from './analysis.agent-usage.repository'

describe('Agent usage diagnostics persistence', () => {
    it('结算时保存安全输入诊断和完整 Token 分项', async () => {
        const execute = vi.fn().mockResolvedValue([{ id: 'usage-id' }])

        await settleAgentUsageCall(
            {
                id: '00000000-0000-4000-8000-000000000001',
                status: 'succeeded',
                errorCategory: null,
                retryScheduled: false,
                executionId: 'codex-thread-1',
                usage: {
                    inputTokens: 120,
                    textInputTokens: null,
                    imageInputTokens: null,
                    cachedInputTokens: 80,
                    reasoningTokens: 5,
                    outputTokens: 20,
                    totalTokens: 140,
                },
                inputDiagnostics: {
                    schemaVersion: 'agent-request-diagnostics.v1',
                    cacheBoundaryFingerprint: 'a'.repeat(64),
                    promptVersion: 'generate-result.v8',
                    targetSchemaVersion: 'generate-result.schema.v6',
                    toolConfigurationVersion: 'codex-tools-disabled.v1',
                    promptCharacterCount: 2_000,
                    stablePrefixCharacterCount: 500,
                    schemaCharacterCount: 800,
                    historyItemCount: 0,
                    historyCharacterCount: 0,
                    evidenceNoteCount: 3,
                    evidenceCharacterCount: 400,
                    imageCount: 2,
                    videoFrameCount: 0,
                    images: [
                        {
                            width: 1_536,
                            height: 1_024,
                            detail: 'provider_default',
                        },
                    ],
                },
                meteredTokens: 140,
                completedAt: '2026-08-24T00:00:00.000Z',
                durationMs: 100,
                estimatedCostMicrousd: null,
            },
            { execute } as never,
        )

        const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0])
        expect(query.sql).toMatch(
            /cached_input_tokens[\s\S]*reasoning_tokens[\s\S]*input_diagnostics/iu,
        )
        expect(JSON.stringify(query.params)).not.toMatch(/userText|prompt":"|secret/iu)
    })

    it('按模型、阶段和 Prompt 版本汇总缓存覆盖、命中、占比与前后耗时', async () => {
        const execute = vi.fn().mockResolvedValue([
            {
                stage: 'generate_result',
                model: 'gpt-5.6-sol',
                promptVersion: 'generate-result.v8',
                totalCalls: '4',
                observableCalls: '3',
                cacheHitCalls: '2',
                observedInputTokens: '1000',
                cachedInputTokens: '600',
                firstAverageDurationMs: '1200',
                repeatedAverageDurationMs: '800',
            },
        ])

        const summaries = await findAgentPromptCacheSummaries(
            { execute } as never,
            '2026-08-24T00:00:00.000Z',
            '2026-08-25T00:00:00.000Z',
        )

        expect(summaries).toEqual([
            {
                stage: 'generate_result',
                model: 'gpt-5.6-sol',
                promptVersion: 'generate-result.v8',
                totalCalls: 4,
                observableCalls: 3,
                cacheHitCalls: 2,
                cacheFieldCoverage: 0.75,
                cacheHitRate: 2 / 3,
                cachedInputRatio: 0.6,
                firstAverageDurationMs: 1_200,
                repeatedAverageDurationMs: 800,
            },
        ])
        const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0])
        expect(query.sql).toMatch(/row_number\(\) OVER/iu)
        expect(query.sql).toContain("input_diagnostics ->> 'cacheBoundaryFingerprint'")
        expect(query.sql).toMatch(/cached_input_tokens > 0/iu)
        expect(query.sql).toMatch(/avg\(duration_ms\)/iu)
        expect(query.sql).not.toMatch(/prompt_text|user_text|result_body/iu)
    })
})
