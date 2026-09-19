import { API_CODES, HTTP_STATUS } from '../../config/constants'

import { fail, ok } from '../../utils/response'

import {
    AnalysisPreparationRateError,
    AnalysisRollingUsageExhaustedError,
} from '../analysis.errors'

import {
    analysisConversationSessionIdentitySchema,
    analysisConversationTurnRecoveryRequestSchema,
    analysisConversationTurnRequestSchema,
} from './analysis.conversation.contract'

import { analysisConversationTurnRunService } from './analysis.conversation-turn-run.service'

import {
    AnalysisConversationBudgetExhaustedError,
    clearAnalysisConversationAuthority,
    formRecoverableAnalysisConversationTurn,
    getAnalysisConversationAuthority,
} from './analysis.conversation.service'

import { recordConversationLimit } from '../http/analysis.http-events'
import { domainErrorResponse } from '../http/analysis.http-errors'

/** 校验并执行一次 Plus 真实任务形成回合；消息正文仅存在于本次调用内。 */
export async function handleAnalysisConversationTurn(
    userId: string,
    authSessionKey: string,
    body: unknown,
) {
    const parsed = analysisConversationTurnRequestSchema.safeParse(body)
    if (!parsed.success) {
        return {
            status: HTTP_STATUS.BAD_REQUEST,
            response: fail(API_CODES.VALIDATION_ERROR, 'Agent 对话内容无效'),
        }
    }
    try {
        const outcome = await formRecoverableAnalysisConversationTurn(
            userId,
            authSessionKey,
            parsed.data,
        )
        const turn = outcome.result
        if (turn.tokenBudget?.exhausted) {
            recordConversationLimit(userId, parsed.data, {
                limitType: 'session_token_budget',
                cycleKey: `session:${parsed.data.session.sessionId}:generation:${parsed.data.session.generation}`,
                consumedTokens: turn.tokenBudget.consumedTokens,
                limitTokens: turn.tokenBudget.normalTokenBudget,
                usageRatio: turn.tokenBudget.consumedTokens / turn.tokenBudget.normalTokenBudget,
                retryAfterSeconds: null,
                canFinalizeDraft: true,
                canUpgrade: false,
            })
        }
        if (turn.rollingUsage.exhausted && turn.rollingUsage.retryAt) {
            recordConversationLimit(userId, parsed.data, {
                limitType: 'rolling_account_token_limit',
                cycleKey: `rolling_agent_usage:${turn.rollingUsage.retryAt}`,
                consumedTokens: null,
                limitTokens: null,
                usageRatio: null,
                retryAfterSeconds: turn.rollingUsage.retryAfterSeconds,
                canFinalizeDraft: turn.action === 'draft_ready',
                canUpgrade: turn.rollingUsage.canUpgrade,
            })
        }
        return { status: HTTP_STATUS.OK, response: ok(outcome) }
    } catch (error) {
        if (error instanceof AnalysisConversationBudgetExhaustedError) {
            recordConversationLimit(userId, parsed.data, {
                limitType: 'session_token_budget',
                cycleKey: `session:${parsed.data.session.sessionId}:generation:${parsed.data.session.generation}`,
                consumedTokens: null,
                limitTokens: null,
                usageRatio: null,
                retryAfterSeconds: null,
                canFinalizeDraft: true,
                canUpgrade: false,
            })
        } else if (error instanceof AnalysisRollingUsageExhaustedError) {
            recordConversationLimit(userId, parsed.data, {
                limitType: 'rolling_account_token_limit',
                cycleKey: `rolling_agent_usage:${error.retryAt}`,
                consumedTokens: null,
                limitTokens: null,
                usageRatio: null,
                retryAfterSeconds: error.retryAfterSeconds,
                canFinalizeDraft: false,
                canUpgrade: error.canUpgrade,
            })
        } else if (error instanceof AnalysisPreparationRateError) {
            recordConversationLimit(userId, parsed.data, {
                limitType: 'send_window_limit',
                cycleKey: `analysis_preparation_rate:${error.retryAt}`,
                consumedTokens: null,
                limitTokens: null,
                usageRatio: null,
                retryAfterSeconds: error.retryAfterSeconds,
                canFinalizeDraft: false,
                canUpgrade: false,
            })
        }
        return domainErrorResponse(error)
    }
}

/** 恢复当前浏览器仍未领取的一轮 Agent 结果。 */
export async function handleRecoverAnalysisConversationTurn(userId: string, body: unknown) {
    const parsed = analysisConversationTurnRecoveryRequestSchema.safeParse(body)
    if (!parsed.success) {
        return {
            status: HTTP_STATUS.BAD_REQUEST,
            response: fail(API_CODES.VALIDATION_ERROR, 'Agent 回合恢复信息无效'),
        }
    }
    const turn = await analysisConversationTurnRunService.recover(
        userId,
        parsed.data.turnId,
        parsed.data.session,
    )
    return { status: HTTP_STATUS.OK, response: ok({ turn }) }
}

/** IndexedDB 已完成落盘后清除云端结果正文。 */
export async function handleAcknowledgeAnalysisConversationTurn(userId: string, body: unknown) {
    const parsed = analysisConversationTurnRecoveryRequestSchema.safeParse(body)
    if (!parsed.success) {
        return {
            status: HTTP_STATUS.BAD_REQUEST,
            response: fail(API_CODES.VALIDATION_ERROR, 'Agent 回合确认信息无效'),
        }
    }
    const acknowledged = await analysisConversationTurnRunService.acknowledge(
        userId,
        parsed.data.turnId,
        parsed.data.session,
    )
    return { status: HTTP_STATUS.OK, response: ok({ acknowledged }) }
}

/** Read the current account authority without creating or taking over a session. */
export async function handleGetAnalysisConversationControl(userId: string) {
    return {
        status: HTTP_STATUS.OK,
        response: ok({ control: await getAnalysisConversationAuthority(userId) }),
    }
}

/** Clear only the caller's exact current conversation identity. */
export async function handleClearAnalysisConversation(userId: string, body: unknown) {
    const parsed = analysisConversationSessionIdentitySchema.safeParse(body)
    if (!parsed.success) {
        return {
            status: HTTP_STATUS.BAD_REQUEST,
            response: fail(API_CODES.VALIDATION_ERROR, 'Agent 会话身份无效'),
        }
    }
    try {
        return {
            status: HTTP_STATUS.OK,
            response: ok(await clearAnalysisConversationAuthority(userId, parsed.data)),
        }
    } catch (error) {
        return domainErrorResponse(error)
    }
}
