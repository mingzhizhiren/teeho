import type { z } from 'zod'
import type { AnalysisDraft } from '../analysis.schema'
import type { analysisConversationTurnRequestSchema } from '../conversation/analysis.conversation.contract'

export interface ConversationLimitEvent {
    readonly limitType: 'session_token_budget' | 'rolling_account_token_limit' | 'send_window_limit'
    readonly cycleKey: string
    readonly consumedTokens: number | null
    readonly limitTokens: number | null
    readonly usageRatio: number | null
    readonly retryAfterSeconds: number | null
    readonly canFinalizeDraft: boolean
    readonly canUpgrade: boolean
}

export interface AnalysisHttpEvents {
    conversationLimit?(
        userId: string,
        input: z.infer<typeof analysisConversationTurnRequestSchema>,
        value: ConversationLimitEvent,
    ): void
    admissionBlocked?(userId: string, draft: AnalysisDraft, entityKey: string, error: unknown): void
}

let events: AnalysisHttpEvents = {}

/** 部署侧可观察受理事件；默认社区版不采集推广或运营数据。 */
export function configureAnalysisHttpEvents(value: AnalysisHttpEvents): void {
    events = value
}

export function recordConversationLimit(
    userId: string,
    input: z.infer<typeof analysisConversationTurnRequestSchema>,
    value: ConversationLimitEvent,
): void {
    events.conversationLimit?.(userId, input, value)
}

export function recordTaskAdmissionBlock(
    userId: string,
    draft: AnalysisDraft,
    entityKey: string,
    error: unknown,
): void {
    events.admissionBlocked?.(userId, draft, entityKey, error)
}
