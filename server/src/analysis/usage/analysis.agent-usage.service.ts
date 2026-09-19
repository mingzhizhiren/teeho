import {
    AgentCancelledError,
    AgentProviderError,
    agentProviderErrorLogFields,
    attachAgentProviderExecutionMetadata,
    readAgentProviderExecutionMetadata,
    type AgentProviderExecutionMetadata,
} from '../providers/analysis.provider'
import type {
    AgentUsageAssociation,
    AgentUsageCallPersistence,
    AgentUsageCallStage,
    AgentUsageCallTerminalRecord,
    AgentUsagePriceSnapshot,
    AgentUsageProvider,
    AgentUsageProviderDescriptor,
} from './analysis.agent-usage.contract'
import { insertAgentUsageCall, settleAgentUsageCall } from './analysis.agent-usage.repository'

export type {
    AgentUsageAssociation,
    AgentUsageCallPersistence,
    AgentUsageCallStage,
    AgentUsageCallStartRecord,
    AgentUsageCallTerminalRecord,
    AgentUsagePriceSnapshot,
    AgentUsageProvider,
    AgentUsageProviderDescriptor,
} from './analysis.agent-usage.contract'

interface AgentUsageCallClock {
    now: () => number
    randomUUID: () => string
}

export interface ExecuteAgentUsageCallOptions<T> {
    userId: string
    association: AgentUsageAssociation
    requestId: string
    stage: AgentUsageCallStage
    provider: AgentUsageProviderDescriptor
    promptVersion: string
    attemptNumber: number
    media: {
        imageInputCount: number
        videoFrameInputCount: number
    }
    invoke: () => Promise<unknown> | unknown
    parse: (rawResult: unknown) => T
    shouldRetry: (error: unknown) => boolean
    fallbackTokenCount?: number
}

interface CreateAgentUsageCallServiceOptions {
    persistence?: AgentUsageCallPersistence
    clock?: AgentUsageCallClock
    log?: AgentUsageCallLogger
    debugEnabled?: boolean
}

interface AgentUsageCallLogger {
    debug(fields: Record<string, unknown>, message: string): void
}

const providerVersions: Record<AgentUsageProvider, string> = {
    mock: 'mock.v1',
    'codex-cli': 'codex-cli.v1',
    openai: 'mastra.v1',
    gemini: 'mastra.v1',
}

const pricingModes: Record<AgentUsageProvider, AgentUsagePriceSnapshot['pricingMode']> = {
    mock: 'no_charge',
    'codex-cli': 'subscription',
    openai: 'unconfigured',
    gemini: 'unconfigured',
}

const postgresAgentUsageCallPersistence: AgentUsageCallPersistence = {
    start: insertAgentUsageCall,
    settle: settleAgentUsageCall,
}

const systemAgentUsageCallClock: AgentUsageCallClock = {
    now: Date.now,
    randomUUID: () => crypto.randomUUID(),
}

/** 冻结调用开始时适用的 Provider 成本解释；未知费率明确保留为 null。 */
export function createAgentUsagePriceSnapshot(
    descriptor: AgentUsageProviderDescriptor,
): AgentUsagePriceSnapshot {
    return {
        schemaVersion: 'agent-usage-price.v1',
        provider: descriptor.provider,
        model: descriptor.model,
        currency: 'USD',
        pricingMode: pricingModes[descriptor.provider],
        ratesMicrousdPerMillionTokens: {
            input: null,
            cachedInput: null,
            imageInput: null,
            reasoning: null,
            output: null,
        },
    }
}

/** 把任意错误压缩为稳定的内部调用失败类别。 */
function errorCategory(error: unknown) {
    return error instanceof AgentProviderError ? error.category : 'unknown'
}

/** 额度计量优先采用 Provider 精确总量，缺失时使用调用方的保守估算。 */
function meteredTokens(
    metadata: AgentProviderExecutionMetadata | null,
    fallbackTokenCount: number | undefined,
) {
    return Math.max(0, Math.trunc(metadata?.usage?.totalTokens ?? fallbackTokenCount ?? 0))
}

/** 创建独立于用户积分和草稿窗口的内部 Agent 调用计量服务。 */
export function createAgentUsageCallService(options: CreateAgentUsageCallServiceOptions = {}) {
    const persistence = options.persistence ?? postgresAgentUsageCallPersistence
    const clock = options.clock ?? systemAgentUsageCallClock
    const log = options.log
    const debugEnabled = options.debugEnabled ?? (typeof DEBUG !== 'undefined' && DEBUG === true)

    /** 调试构建按调用输出完整 Token 构成；发布构建不产生额外日志。 */
    async function logSettledUsage(
        call: ExecuteAgentUsageCallOptions<unknown>,
        terminal: AgentUsageCallTerminalRecord,
        error?: unknown,
    ) {
        if (!debugEnabled) {
            return
        }
        try {
            const debugLog = log ?? (await import('../../utils/logger')).logger
            debugLog.debug(
                {
                    event: 'agent_call_settled',
                    requestId: call.requestId,
                    ...(error ? agentProviderErrorLogFields(error, true) : {}),
                    agentUsage: {
                        associationKind: call.association.kind,
                        associationId: call.association.id,
                        requestId: call.requestId,
                        executionId: terminal.executionId,
                        stage: call.stage,
                        attemptNumber: call.attemptNumber,
                        status: terminal.status,
                        errorCategory: terminal.errorCategory,
                        retryScheduled: terminal.retryScheduled,
                        provider: call.provider.provider,
                        model: call.provider.model,
                        providerVersion:
                            call.provider.providerVersion ??
                            providerVersions[call.provider.provider],
                        promptVersion: call.promptVersion,
                        imageInputCount: call.media.imageInputCount,
                        videoFrameInputCount: call.media.videoFrameInputCount,
                        usage: terminal.usage,
                        inputDiagnostics: terminal.inputDiagnostics,
                        meteredTokens: terminal.meteredTokens,
                        durationMs: terminal.durationMs,
                    },
                },
                'Agent Token 用量',
            )
        } catch {
            process.stderr.write('Agent Token 调试日志输出失败\n')
        }
    }

    return {
        async execute<T>(call: ExecuteAgentUsageCallOptions<T>): Promise<{
            value: T
            metadata: AgentProviderExecutionMetadata | null
        }> {
            const startedAtMs = clock.now()
            const id = clock.randomUUID()
            await persistence.start({
                id,
                userId: call.userId,
                associationKind: call.association.kind,
                associationId: call.association.id,
                taskId: call.association.kind === 'task' ? call.association.id : null,
                requestId: call.requestId,
                stage: call.stage,
                provider: call.provider.provider,
                model: call.provider.model,
                providerVersion:
                    call.provider.providerVersion ?? providerVersions[call.provider.provider],
                promptVersion: call.promptVersion,
                attemptNumber: call.attemptNumber,
                imageInputCount: call.media.imageInputCount,
                videoFrameInputCount: call.media.videoFrameInputCount,
                priceSnapshot: createAgentUsagePriceSnapshot(call.provider),
                startedAt: new Date(startedAtMs).toISOString(),
            })

            let rawResult: unknown
            let value: T
            try {
                rawResult = await call.invoke()
                value = call.parse(rawResult)
            } catch (error) {
                const metadata =
                    readAgentProviderExecutionMetadata(rawResult) ??
                    readAgentProviderExecutionMetadata(error)
                const completedAtMs = clock.now()
                const terminal: AgentUsageCallTerminalRecord = {
                    id,
                    status: error instanceof AgentCancelledError ? 'cancelled' : 'technical_failed',
                    errorCategory: errorCategory(error),
                    retryScheduled: call.shouldRetry(error),
                    executionId: metadata?.executionId ?? null,
                    usage: metadata?.usage ?? null,
                    inputDiagnostics: metadata?.inputDiagnostics ?? null,
                    meteredTokens: meteredTokens(metadata, call.fallbackTokenCount),
                    completedAt: new Date(completedAtMs).toISOString(),
                    durationMs: Math.max(0, completedAtMs - startedAtMs),
                    estimatedCostMicrousd: null,
                }
                await persistence.settle(terminal)
                await logSettledUsage(call, terminal, error)
                if (metadata) {
                    attachAgentProviderExecutionMetadata(error, metadata)
                }
                throw error
            }

            const metadata = readAgentProviderExecutionMetadata(rawResult)
            const completedAtMs = clock.now()
            const terminal: AgentUsageCallTerminalRecord = {
                id,
                status: 'succeeded',
                errorCategory: null,
                retryScheduled: false,
                executionId: metadata?.executionId ?? null,
                usage: metadata?.usage ?? null,
                inputDiagnostics: metadata?.inputDiagnostics ?? null,
                meteredTokens: meteredTokens(metadata, call.fallbackTokenCount),
                completedAt: new Date(completedAtMs).toISOString(),
                durationMs: Math.max(0, completedAtMs - startedAtMs),
                estimatedCostMicrousd: null,
            }
            await persistence.settle(terminal)
            await logSettledUsage(call, terminal)
            return { value, metadata }
        },
    }
}

/** 生产运行时共享的内部 Agent 调用计量服务。 */
export const agentUsageCallService = createAgentUsageCallService()

/** 记录智能体调用用量的服务。 */
export type AgentUsageCallService = typeof agentUsageCallService
