import type { z } from 'zod'
import type { AnalysisDraft } from '../analysis.schema'
import type { analysisConversationTurnRequestSchema } from '../conversation/analysis.conversation.contract'
import { logger } from '../../utils/logger'
import { analysisObservationErrorCategory } from '../analysis.observation'

export type AnalysisClientKind = 'web' | 'skill' | 'unknown'

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
    reportReturned?(userId: string, taskId: string, resultVersion: number): Promise<void>
    taskAccepted?(userId: string, taskId: string, source: AnalysisClientKind): Promise<void>
    conversationLimit?(
        userId: string,
        input: z.infer<typeof analysisConversationTurnRequestSchema>,
        value: ConversationLimitEvent,
    ): void
    admissionBlocked?(userId: string, draft: AnalysisDraft, entityKey: string, error: unknown): void
}

let events: AnalysisHttpEvents = {}

/** Skill 仅以完整报告返回作为查看信号，状态轮询和列表不触发。 */
export async function recordReportReturned(
    userId: string,
    task: { id: string; resultVersion?: number | null; result?: unknown } | null,
    source: AnalysisClientKind,
): Promise<void> {
    if (source !== 'skill' || !task?.result || !task.resultVersion) return
    try {
        await events.reportReturned?.(userId, task.id, task.resultVersion)
    } catch (error) {
        logger.warn(
            {
                event: 'analysis_report_observation_failed',
                taskId: task.id,
                resultVersion: task.resultVersion,
                source,
                errorCategory: analysisObservationErrorCategory(error),
            },
            '报告已返回，统计暂不可用',
        )
    }
}

/** 业务事务已经成功，观测失败不会改变受理结果。 */
export async function recordTaskAccepted(
    userId: string,
    taskId: string,
    source: AnalysisClientKind,
): Promise<void> {
    try {
        await events.taskAccepted?.(userId, taskId, source)
    } catch (error) {
        logger.warn(
            {
                event: 'analysis_admission_observation_failed',
                taskId,
                source,
                errorCategory: analysisObservationErrorCategory(error),
            },
            '任务已受理，统计暂不可用',
        )
    }
}

/** 部署侧可观察受理事件；默认配置不采集推广或运营数据。 */
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
