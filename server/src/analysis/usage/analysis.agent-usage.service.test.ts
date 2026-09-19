import { describe, expect, it, vi } from 'vitest'

import {
    AgentCancelledError,
    AgentContractError,
    AgentProviderError,
    attachAgentProviderExecutionMetadata,
    readAgentProviderExecutionMetadata,
} from '../providers/analysis.provider'
import {
    createAgentUsageCallService,
    type AgentUsageCallPersistence,
    type AgentUsageCallStartRecord,
    type AgentUsageCallTerminalRecord,
} from './analysis.agent-usage.service'

const userId = '00000000-0000-4000-8000-000000000001'
const draftId = '00000000-0000-4000-8000-000000000002'
const requestId = '00000000-0000-4000-8000-000000000003'
const callId = '00000000-0000-4000-8000-000000000004'

function createHarness(
    nowValues = [1_000, 1_125],
    options: { debugEnabled?: boolean; debug?: ReturnType<typeof vi.fn> } = {},
) {
    const started: AgentUsageCallStartRecord[] = []
    const settled: AgentUsageCallTerminalRecord[] = []
    let nowIndex = 0
    const persistence: AgentUsageCallPersistence = {
        async start(record) {
            started.push(record)
        },
        async settle(record) {
            settled.push(record)
        },
    }
    const service = createAgentUsageCallService({
        persistence,
        debugEnabled: options.debugEnabled,
        log: options.debug ? { debug: options.debug } : undefined,
        clock: {
            now: () => nowValues[Math.min(nowIndex++, nowValues.length - 1)]!,
            randomUUID: () => callId,
        },
    })
    return { service, settled, started }
}

const baseCall = {
    userId,
    association: { kind: 'conversation' as const, id: draftId },
    requestId,
    stage: 'form_conversation_turn' as const,
    provider: { provider: 'openai' as const, model: 'gpt-test-2026-08-05' },
    promptVersion: 'form-conversation-turn.v1',
    attemptNumber: 1,
    media: { imageInputCount: 2, videoFrameInputCount: 0 },
}

const inputDiagnostics = {
    schemaVersion: 'agent-request-diagnostics.v1' as const,
    cacheBoundaryFingerprint: 'a'.repeat(64),
    promptVersion: 'form-conversation-turn.v1',
    targetSchemaVersion: 'prepare-draft.schema.v1',
    toolConfigurationVersion: 'codex-tools-disabled.v1',
    promptCharacterCount: 1_200,
    stablePrefixCharacterCount: 300,
    schemaCharacterCount: 500,
    historyItemCount: 0,
    historyCharacterCount: 0,
    evidenceNoteCount: 0,
    evidenceCharacterCount: 0,
    imageCount: 2,
    videoFrameCount: 0,
    images: [
        { width: 1_536, height: 1_024, detail: 'provider_default' as const },
        { width: 1_024, height: 1_536, detail: 'provider_default' as const },
    ],
}

describe('Agent usage call service', () => {
    it('在调用前冻结归因与价格配置，并在成功后保存完整 Provider 用量', async () => {
        const { service, settled, started } = createHarness()
        const rawResult = attachAgentProviderExecutionMetadata(
            { accepted: true },
            {
                executionId: 'provider-execution-1',
                usage: {
                    inputTokens: 120,
                    textInputTokens: 80,
                    imageInputTokens: 40,
                    cachedInputTokens: 20,
                    reasoningTokens: 10,
                    outputTokens: 30,
                    totalTokens: 150,
                },
                inputDiagnostics,
            },
        )

        const outcome = await service.execute({
            ...baseCall,
            invoke: vi.fn(async () => rawResult),
            parse: (raw) => raw as { accepted: boolean },
            shouldRetry: () => false,
        })

        expect(outcome.value).toEqual({ accepted: true })
        expect(outcome.metadata?.executionId).toBe('provider-execution-1')
        expect(started).toEqual([
            expect.objectContaining({
                id: callId,
                userId,
                associationKind: 'conversation',
                associationId: draftId,
                taskId: null,
                requestId,
                stage: 'form_conversation_turn',
                provider: 'openai',
                model: 'gpt-test-2026-08-05',
                providerVersion: 'mastra.v1',
                promptVersion: 'form-conversation-turn.v1',
                attemptNumber: 1,
                imageInputCount: 2,
                videoFrameInputCount: 0,
                priceSnapshot: expect.objectContaining({
                    schemaVersion: 'agent-usage-price.v1',
                    provider: 'openai',
                    model: 'gpt-test-2026-08-05',
                    pricingMode: 'unconfigured',
                }),
            }),
        ])
        expect(settled).toEqual([
            {
                id: callId,
                status: 'succeeded',
                errorCategory: null,
                retryScheduled: false,
                executionId: 'provider-execution-1',
                usage: expect.objectContaining({
                    cachedInputTokens: 20,
                    reasoningTokens: 10,
                }),
                inputDiagnostics,
                meteredTokens: 150,
                completedAt: new Date(1_125).toISOString(),
                durationMs: 125,
                estimatedCostMicrousd: null,
            },
        ])
    })

    it('调试模式打印单次调用的完整 Token 构成和任务归属', async () => {
        const debug = vi.fn()
        const { service } = createHarness([1_000, 1_125], { debugEnabled: true, debug })
        const rawResult = attachAgentProviderExecutionMetadata(
            { accepted: true },
            {
                executionId: 'provider-execution-1',
                usage: {
                    inputTokens: 120,
                    textInputTokens: 80,
                    imageInputTokens: 40,
                    cachedInputTokens: 20,
                    reasoningTokens: 10,
                    outputTokens: 30,
                    totalTokens: 150,
                },
            },
        )

        await service.execute({
            ...baseCall,
            association: { kind: 'task', id: draftId },
            stage: 'generate_result',
            invoke: async () => rawResult,
            parse: (raw) => raw,
            shouldRetry: () => false,
        })

        expect(debug).toHaveBeenCalledWith(
            {
                event: 'agent_call_settled',
                requestId,
                agentUsage: expect.objectContaining({
                    associationKind: 'task',
                    associationId: draftId,
                    stage: 'generate_result',
                    status: 'succeeded',
                    usage: expect.objectContaining({
                        inputTokens: 120,
                        cachedInputTokens: 20,
                        reasoningTokens: 10,
                        outputTokens: 30,
                        totalTokens: 150,
                    }),
                    meteredTokens: 150,
                    durationMs: 125,
                }),
            },
            'Agent Token 用量',
        )
    })

    it('非调试模式不打印 Token 用量', async () => {
        const debug = vi.fn()
        const { service } = createHarness([1_000, 1_125], { debugEnabled: false, debug })

        await service.execute({
            ...baseCall,
            invoke: async () => ({ accepted: true }),
            parse: (raw) => raw,
            fallbackTokenCount: 77,
            shouldRetry: () => false,
        })

        expect(debug).not.toHaveBeenCalled()
    })

    it('调试日志使用稳定错误分类和规则编号且不输出 Provider 原始错误', async () => {
        const debug = vi.fn()
        const { service } = createHarness([1_000, 1_125], { debugEnabled: true, debug })
        const providerError = new AgentProviderError('budget_exhausted', {
            message: '包含不应写入日志的远端原始内容',
            retryable: false,
            ruleId: 'codex-app-server.token-budget',
            validationFieldPaths: ['usage.totalTokens'],
        })

        await expect(
            service.execute({
                ...baseCall,
                invoke: async () => {
                    throw providerError
                },
                parse: (raw) => raw,
                shouldRetry: () => false,
            }),
        ).rejects.toBe(providerError)

        expect(debug).toHaveBeenCalledWith(
            expect.objectContaining({
                event: 'agent_call_settled',
                requestId,
                errorCategory: 'budget_exhausted',
                ruleId: 'codex-app-server.token-budget',
                validationFieldPaths: ['usage.totalTokens'],
            }),
            'Agent Token 用量',
        )
        expect(JSON.stringify(debug.mock.calls)).not.toContain('包含不应写入日志的远端原始内容')
    })

    it('缺失 usage 保持未知，且异常输出作为独立可重试失败调用结算', async () => {
        const { service, settled } = createHarness()
        const rawResult = { title: '残缺结果' }

        await expect(
            service.execute({
                ...baseCall,
                invoke: async () => rawResult,
                parse() {
                    throw new AgentContractError('结构无效')
                },
                fallbackTokenCount: 77,
                shouldRetry: () => true,
            }),
        ).rejects.toBeInstanceOf(AgentContractError)

        expect(settled).toEqual([
            expect.objectContaining({
                id: callId,
                status: 'technical_failed',
                errorCategory: 'invalid_output',
                retryScheduled: true,
                executionId: null,
                usage: null,
                meteredTokens: 77,
                durationMs: 125,
            }),
        ])
    })

    it('多轮结果整包校验失败时仍结算 Provider 已报告的用量', async () => {
        const { service, settled } = createHarness()
        const rawResult = attachAgentProviderExecutionMetadata(
            { incomplete: true },
            {
                executionId: 'conversation-execution-1',
                usage: {
                    inputTokens: 90,
                    textInputTokens: 90,
                    imageInputTokens: 0,
                    cachedInputTokens: 0,
                    reasoningTokens: 5,
                    outputTokens: 10,
                    totalTokens: 105,
                },
            },
        )

        const error = await service
            .execute({
                ...baseCall,
                association: { kind: 'conversation', id: draftId },
                stage: 'form_conversation_turn',
                invoke: async () => rawResult,
                parse() {
                    throw new AgentContractError('多轮整包结构无效')
                },
                shouldRetry: () => false,
            })
            .catch((caught: unknown) => caught)

        expect(error).toBeInstanceOf(AgentContractError)
        expect(readAgentProviderExecutionMetadata(error)?.usage?.totalTokens).toBe(105)

        expect(settled[0]).toMatchObject({
            status: 'technical_failed',
            executionId: 'conversation-execution-1',
            usage: { totalTokens: 105 },
        })
    })

    it('取消调用单独记录为 cancelled，不伪装成技术失败或重试', async () => {
        const { service, settled } = createHarness()

        await expect(
            service.execute({
                ...baseCall,
                association: { kind: 'task', id: draftId },
                stage: 'generate_result',
                invoke() {
                    throw new AgentCancelledError()
                },
                parse: vi.fn(),
                shouldRetry: () => false,
            }),
        ).rejects.toBeInstanceOf(AgentCancelledError)

        expect(settled[0]).toMatchObject({
            status: 'cancelled',
            errorCategory: 'cancelled',
            retryScheduled: false,
        })
    })

    it('Provider 在失败对象上附带用量时按实际总量结算', async () => {
        const { service, settled } = createHarness()
        const error = new AgentProviderError('budget_exhausted', {
            retryable: false,
            ruleId: 'codex-app-server.token-budget',
        })
        attachAgentProviderExecutionMetadata(error, {
            executionId: 'research-execution-1',
            usage: {
                inputTokens: 5_000,
                textInputTokens: 5_000,
                imageInputTokens: 0,
                cachedInputTokens: 0,
                reasoningTokens: 0,
                outputTokens: 1_001,
                totalTokens: 6_001,
            },
        })

        await expect(
            service.execute({
                ...baseCall,
                association: { kind: 'task', id: draftId },
                stage: 'collect_web_research',
                invoke: async () => {
                    throw error
                },
                parse: vi.fn(),
                fallbackTokenCount: 6_000,
                shouldRetry: () => false,
            }),
        ).rejects.toBe(error)

        expect(settled[0]).toMatchObject({
            status: 'technical_failed',
            errorCategory: 'budget_exhausted',
            executionId: 'research-execution-1',
            usage: { totalTokens: 6_001 },
            meteredTokens: 6_001,
        })
    })
})
