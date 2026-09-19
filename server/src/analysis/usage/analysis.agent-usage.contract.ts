import type { AgentProviderUsage } from '../providers/analysis.provider'

/** 当前只记录计数与尺寸，采用数据库既有的基础诊断格式；v2另要求风险策略快照。 */
export const AGENT_REQUEST_DIAGNOSTICS_VERSION = 'agent-request-diagnostics.v1' as const

/** 智能体调用与业务实体的关联信息。 */
export type AgentUsageAssociation =
    | { kind: 'draft'; id: string }
    | { kind: 'conversation'; id: string }
    | { kind: 'task'; id: string }

/** 智能体调用所处阶段。 */
export type AgentUsageCallStage =
    | 'form_conversation_turn'
    | 'collect_web_research'
    | 'generate_result'
    | 'repair_agent_output'

/** 智能体调用提供方标识。 */
export type AgentUsageProvider = 'mock' | 'codex-cli' | 'openai' | 'gemini'

/** 智能体调用提供方描述。 */
export interface AgentUsageProviderDescriptor {
    provider: AgentUsageProvider
    model: string | null
    providerVersion?: string
}

/** 智能体调用时采用的价格快照。 */
export interface AgentUsagePriceSnapshot {
    schemaVersion: 'agent-usage-price.v1'
    provider: AgentUsageProvider
    model: string | null
    currency: 'USD'
    pricingMode: 'no_charge' | 'subscription' | 'unconfigured'
    ratesMicrousdPerMillionTokens: {
        input: number | null
        cachedInput: number | null
        imageInput: number | null
        reasoning: number | null
        output: number | null
    }
}

/** 不含用户正文、Prompt、资源标识或媒体内容的单次 Agent 输入诊断。 */
export interface AgentRequestDiagnostics {
    schemaVersion: typeof AGENT_REQUEST_DIAGNOSTICS_VERSION
    cacheBoundaryFingerprint: string
    promptVersion: string
    targetSchemaVersion: string
    toolConfigurationVersion: string
    promptCharacterCount: number
    stablePrefixCharacterCount: number
    schemaCharacterCount: number
    historyItemCount: number
    historyCharacterCount: number
    evidenceNoteCount: number
    evidenceCharacterCount: number
    imageCount: number
    videoFrameCount: number
    images: Array<{
        width: number
        height: number
        detail: 'provider_default' | 'low'
    }>
}

/** 智能体调用开始记录。 */
export interface AgentUsageCallStartRecord {
    id: string
    userId: string
    associationKind: AgentUsageAssociation['kind']
    associationId: string
    taskId: string | null
    requestId: string
    stage: AgentUsageCallStage
    provider: AgentUsageProvider
    model: string | null
    providerVersion: string
    promptVersion: string
    attemptNumber: number
    imageInputCount: number
    videoFrameInputCount: number
    priceSnapshot: AgentUsagePriceSnapshot
    startedAt: string
}

/** 智能体调用终态记录。 */
export interface AgentUsageCallTerminalRecord {
    id: string
    status: 'succeeded' | 'technical_failed' | 'cancelled'
    errorCategory: string | null
    retryScheduled: boolean
    executionId: string | null
    usage: AgentProviderUsage | null
    inputDiagnostics: AgentRequestDiagnostics | null
    meteredTokens: number
    completedAt: string
    durationMs: number
    estimatedCostMicrousd: number | null
}

/** 智能体调用用量持久化边界。 */
export interface AgentUsageCallPersistence {
    start(record: AgentUsageCallStartRecord): Promise<void>
    settle(record: AgentUsageCallTerminalRecord): Promise<void>
}
