import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { analysisContractVersions, traceAnalysisContract } from './analysis.contract-telemetry'

describe('analysis contract telemetry', () => {
    it('结构失败只记录契约、字段路径和稳定错误分类', async () => {
        const log = { debug: vi.fn() }
        const run = traceAnalysisContract({
            log,
            requestId: '00000000-0000-4000-8000-000000000001',
            taskId: '00000000-0000-4000-8000-000000000002',
            resultVersion: 1,
            attemptNumber: 1,
            contractVersion: analysisContractVersions.result,
            run: () =>
                z
                    .object({ schemaVersion: z.literal('analysis-result.v4') })
                    .strict()
                    .parse({ schemaVersion: 'wrong-version', secret: 'never-log-me' }),
            summarize: () => ({}),
        })

        await expect(run).rejects.toBeInstanceOf(z.ZodError)
        const events = log.debug.mock.calls.map(([fields]) => fields as Record<string, unknown>)
        expect(events).toHaveLength(2)
        expect(events[1]).toMatchObject({
            event: 'analysis_contract_stage',
            state: 'failed',
            contractVersion: 'analysis-result.v6',
            errorCategory: 'schema_validation',
            validationFieldPaths: expect.arrayContaining(['schemaVersion', '$root']),
            ruleId: 'analysis-contract.schema-validation',
        })
        expect(JSON.stringify(events)).not.toContain('never-log-me')
    })

    it('日志或摘要失败不会改变分析阶段的成功结果', async () => {
        const result = await traceAnalysisContract({
            log: {
                debug() {
                    throw new Error('log transport failed')
                },
            },
            requestId: '00000000-0000-4000-8000-000000000001',
            taskId: '00000000-0000-4000-8000-000000000002',
            resultVersion: 1,
            attemptNumber: 1,
            contractVersion: analysisContractVersions.task,
            run: () => 42,
            summarize: () => {
                throw new Error('summary failed')
            },
        })

        expect(result).toBe(42)
    })
})
