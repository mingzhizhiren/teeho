import { TIME_MS } from '../../config/constants'
import { env } from '../../config/env'
import { withTransaction, type DatabaseExecutor } from '../../db/database'
import {
    canUseConversation,
    getAgentPolicy,
    type AgentAccessSnapshot,
} from '../../runtime/agent-policy'
import { resolveAnalysisConversationTurnLeaseSeconds } from '../analysis.constants'
import { AnalysisRollingUsageExhaustedError } from '../analysis.errors'
import {
    AgentContractError,
    readAgentProviderExecutionMetadata,
} from '../providers/analysis.provider'
import type {
    AgentUsageCallService,
    ExecuteAgentUsageCallOptions,
} from '../usage/analysis.agent-usage.service'
import { agentUsageCallService } from '../usage/analysis.agent-usage.service'
import {
    analysisRollingUsageService,
    type AnalysisRollingUsageService,
    type AnalysisRollingUsageStatus,
} from '../usage/analysis.rolling-usage.service'
import {
    AnalysisConversationStaleError,
    claimAnalysisConversationTurn,
    completeAnalysisConversationTurn,
    getAnalysisConversationControl,
    releaseAnalysisConversationTurn,
    resetAnalysisConversationAfterTaskAdmission,
    type AnalysisConversationContentKind,
    type AnalysisConversationLeaseIdentity,
    type AnalysisConversationTurnClaim,
    type AnalysisConversationTurnClaimInput,
    type AnalysisConversationTurnCompletionInput,
} from './analysis.conversation.repository'
import { commitAnalysisDraftSendReservation } from './analysis.draft-send-window.repository'
import {
    analysisDraftSendWindowService,
    type AnalysisDraftSendWindowService,
} from './analysis.draft-send-window.service'

export class AnalysisConversationCapabilityError extends Error {
    constructor(message = '当前部署未启用 Agent 对话') {
        super(message)
        this.name = 'AnalysisConversationCapabilityError'
    }
}

export class AnalysisConversationBudgetExhaustedError extends Error {
    constructor(message = '当前对话信息已达上限，请开始分析或清空后重新开始。') {
        super(message)
        this.name = 'AnalysisConversationBudgetExhaustedError'
    }
}

export interface AnalysisConversationBudgetSnapshot {
    normalTokenBudget: number
    finalDraftTokenReserve: number
    consumedTokens: number
    percentage: number
    tone: 'green' | 'yellow' | 'red'
    exhausted: boolean
    thresholds: {
        yellow: number
        red: number
        exhausted: number
    }
}

interface AnalysisConversationControlBoundary {
    inspect(userId: string): ReturnType<typeof getAnalysisConversationControl>
    claim(input: AnalysisConversationTurnClaimInput): Promise<AnalysisConversationTurnClaim>
    release(input: AnalysisConversationLeaseIdentity): Promise<boolean>
    resetAfterTaskAdmission(userId: string): Promise<boolean>
}

interface AnalysisConversationTurnSettlementBoundary {
    completeAndCommit(
        input: AnalysisConversationTurnCompletionInput,
        reservationId: string | null,
        onCompleted?: (executor: DatabaseExecutor, consumedTokens: number) => Promise<void>,
    ): Promise<{ completed: boolean; consumedTokens: number | null }>
}

interface SettledConversationTurn<T> {
    value: T
    session: {
        sessionId: string
        generation: number
        browserInstanceId: string
    }
    budget: AnalysisConversationBudgetSnapshot | null
    rollingUsage: {
        exhausted: boolean
        retryAt: string | null
        retryAfterSeconds: number
        canUpgrade: boolean
    }
}

type ManagedUsageCall<T> = Omit<ExecuteAgentUsageCallOptions<T>, 'userId'>
type ExecuteManagedProvider = <T>(call: ManagedUsageCall<T>) => Promise<{
    value: T
    metadata: Awaited<ReturnType<AgentUsageCallService['execute']>>['metadata']
}>

function normalizedTokenCount(reported: number | null | undefined, fallback: number): number {
    return Math.max(0, Math.trunc(typeof reported === 'number' ? reported : fallback))
}

function providerTokenCount(value: unknown, fallback: number): number {
    return normalizedTokenCount(
        readAgentProviderExecutionMetadata(value)?.usage?.totalTokens,
        fallback,
    )
}

interface TokenManagementDependencies {
    entitlement?: (userId: string) => Promise<AgentAccessSnapshot>
    limitsEnabled?: () => boolean
    sendWindow?: AnalysisDraftSendWindowService
    usage?: AgentUsageCallService
    control?: AnalysisConversationControlBoundary
    settlement?: AnalysisConversationTurnSettlementBoundary
    rollingUsage?: AnalysisRollingUsageService
}

const postgresConversationControl: AnalysisConversationControlBoundary = {
    inspect: getAnalysisConversationControl,
    claim: claimAnalysisConversationTurn,
    release: releaseAnalysisConversationTurn,
    resetAfterTaskAdmission: resetAnalysisConversationAfterTaskAdmission,
}

const postgresConversationTurnSettlement: AnalysisConversationTurnSettlementBoundary = {
    completeAndCommit: (input, reservationId, onCompleted) =>
        withTransaction(async (transaction) => {
            const settlement = await completeAnalysisConversationTurn(input, transaction)
            if (!settlement.completed) return settlement
            if (reservationId) {
                const committed = await commitAnalysisDraftSendReservation(
                    transaction,
                    input.userId,
                    reservationId,
                )
                if (!committed) {
                    throw new Error('草稿发送占位无法与会话回合原子结算')
                }
            }
            if (settlement.consumedTokens !== null) {
                await onCompleted?.(transaction, settlement.consumedTokens)
            }
            return settlement
        }),
}

async function authoritativeEntitlement(userId: string) {
    return getAgentPolicy().resolve(userId)
}

function sendWindowPolicy(snapshot: AgentAccessSnapshot) {
    return {
        windowDurationMs: snapshot.agentPolicy.sendWindowSeconds * TIME_MS.SECOND,
        maxAcceptedSends: snapshot.agentPolicy.sendLimit,
    }
}

export function createConversationBudgetSnapshot(
    entitlement: AgentAccessSnapshot,
    consumedTokens: number,
): AnalysisConversationBudgetSnapshot | null {
    const normalTokenBudget = entitlement.agentPolicy.sessionTokenBudget
    if (normalTokenBudget === null) return null
    const thresholds = entitlement.agentPolicy.sessionProgressThresholds
    const percentage = Math.min(
        thresholds.exhausted,
        Math.floor((Math.max(0, consumedTokens) / normalTokenBudget) * thresholds.exhausted),
    )
    return {
        normalTokenBudget,
        finalDraftTokenReserve: entitlement.agentPolicy.finalDraftTokenReserve,
        consumedTokens: Math.max(0, consumedTokens),
        percentage,
        tone:
            percentage >= thresholds.red
                ? 'red'
                : percentage >= thresholds.yellow
                  ? 'yellow'
                  : 'green',
        exhausted: percentage >= thresholds.exhausted,
        thresholds: { ...thresholds },
    }
}

/**
 * Deep module for tier policy, send reservations, Provider usage and conversation
 * budget settlement. Callers provide domain parsing/finalization, not token rules.
 */
export function createAnalysisTokenManagementService(
    dependencies: TokenManagementDependencies = {},
) {
    const entitlement = dependencies.entitlement ?? authoritativeEntitlement
    const limitsEnabled = dependencies.limitsEnabled ?? (() => getAgentPolicy().limitsEnabled())
    const sendWindow = dependencies.sendWindow ?? analysisDraftSendWindowService
    const usage = dependencies.usage ?? agentUsageCallService
    const control = dependencies.control ?? postgresConversationControl
    const settlement = dependencies.settlement ?? postgresConversationTurnSettlement

    const rollingUsage = dependencies.rollingUsage ?? analysisRollingUsageService

    const executeProviderFor =
        (userId: string, fallbackTokenCount: number): ExecuteManagedProvider =>
        (call) =>
            usage.execute({ ...call, userId, fallbackTokenCount })

    const publicRollingUsage = (status: AnalysisRollingUsageStatus) => ({
        exhausted: status.exhausted,
        retryAt: status.retryAt,
        retryAfterSeconds: status.retryAfterSeconds,
        canUpgrade: status.canUpgrade,
    })

    const unrestrictedRollingUsage = {
        exhausted: false,
        retryAt: null,
        retryAfterSeconds: 0,
        canUpgrade: false,
    } as const

    const assertRollingUsageAvailable = (status: AnalysisRollingUsageStatus) => {
        if (status.exhausted && status.retryAt) {
            throw new AnalysisRollingUsageExhaustedError(
                status.retryAfterSeconds,
                status.retryAt,
                status.canUpgrade,
            )
        }
    }

    return {
        async authorizeConversation(userId: string) {
            const snapshot = await entitlement(userId)
            if (!canUseConversation(snapshot)) {
                throw new AnalysisConversationCapabilityError()
            }
            return { userId, snapshot }
        },

        async getConversationBudget(userId: string, consumedTokens: number) {
            if (!limitsEnabled()) return null
            const snapshot = await entitlement(userId)
            return createConversationBudgetSnapshot(snapshot, consumedTokens)
        },

        async getRollingUsage(userId: string) {
            if (!limitsEnabled()) return unrestrictedRollingUsage
            const snapshot = await entitlement(userId)
            return publicRollingUsage(await rollingUsage.inspect(userId, snapshot))
        },

        async executeGuidedSend<T>(input: {
            userId: string
            run: (
                executeProvider: ExecuteManagedProvider,
                entitlement: AgentAccessSnapshot,
            ) => Promise<T>
            estimatedTokenCount: number
            forceFinalize?: (value: T) => T
            fallback?: () => T
        }) {
            const entitlementSnapshot = await entitlement(input.userId)
            if (!limitsEnabled()) {
                return input.run(
                    executeProviderFor(input.userId, input.estimatedTokenCount),
                    entitlementSnapshot,
                )
            }
            const beforeRollingUsage = await rollingUsage.inspect(input.userId, entitlementSnapshot)
            assertRollingUsageAvailable(beforeRollingUsage)
            const { reservationId } = await sendWindow.reserve(
                input.userId,
                sendWindowPolicy(entitlementSnapshot),
            )
            try {
                let value: T
                try {
                    value = await input.run(
                        executeProviderFor(input.userId, input.estimatedTokenCount),
                        entitlementSnapshot,
                    )
                } catch (error) {
                    const failedRollingUsage = await rollingUsage.inspect(
                        input.userId,
                        entitlementSnapshot,
                    )
                    if (!failedRollingUsage.exhausted || !input.fallback) throw error
                    value = input.fallback()
                }
                const settledRollingUsage = await rollingUsage.inspect(
                    input.userId,
                    entitlementSnapshot,
                )
                if (settledRollingUsage.exhausted && input.forceFinalize) {
                    value = input.forceFinalize(value)
                }
                await sendWindow.commit(input.userId, reservationId)
                return value
            } catch (error) {
                await sendWindow.release(input.userId, reservationId)
                throw error
            }
        },

        async executeConversationTurn<T>(input: {
            userId: string
            authorization?: {
                userId: string
                snapshot: AgentAccessSnapshot
            }
            authority: {
                sessionId: string
                generation: number
                browserInstanceId: string
                contentKind: AnalysisConversationContentKind
                leaseId: string
            }
            usageCall: ManagedUsageCall<T>
            retryUsageCall?: ManagedUsageCall<T>
            onClaimed?: () => Promise<void>
            onSettled?: (
                executor: DatabaseExecutor,
                outcome: SettledConversationTurn<T>,
            ) => Promise<void>
            forceFinalize: (value: T) => T
            fallback: () => T
            estimatedTokenCount: number
        }) {
            const enforceLimits = limitsEnabled()
            const entitlementSnapshot =
                input.authorization?.userId === input.userId
                    ? input.authorization.snapshot
                    : await entitlement(input.userId)
            if (!canUseConversation(entitlementSnapshot)) {
                throw new AnalysisConversationCapabilityError()
            }
            if (enforceLimits) {
                const beforeRollingUsage = await rollingUsage.inspect(
                    input.userId,
                    entitlementSnapshot,
                )
                assertRollingUsageAvailable(beforeRollingUsage)
            }
            const current = await control.inspect(input.userId)
            const belongsToRequestedSession =
                current?.sessionId === input.authority.sessionId &&
                current.generation === input.authority.generation &&
                current.browserInstanceId === input.authority.browserInstanceId
            if (enforceLimits) {
                const preflightBudget = createConversationBudgetSnapshot(
                    entitlementSnapshot,
                    belongsToRequestedSession ? current.consumedTokens : 0,
                )
                if (preflightBudget?.exhausted) {
                    throw new AnalysisConversationBudgetExhaustedError()
                }
            }
            let reservationId: string | null = null
            let claim: AnalysisConversationTurnClaim | null = null
            let lease: AnalysisConversationLeaseIdentity | null = null
            let settled = false
            try {
                if (enforceLimits) {
                    ;({ reservationId } = await sendWindow.reserve(
                        input.userId,
                        sendWindowPolicy(entitlementSnapshot),
                    ))
                }
                claim = await control.claim({
                    userId: input.userId,
                    sessionId: input.authority.sessionId,
                    generation: input.authority.generation,
                    browserInstanceId: input.authority.browserInstanceId,
                    contentKind: input.authority.contentKind,
                    leaseId: input.authority.leaseId,
                    leaseDurationSeconds: resolveAnalysisConversationTurnLeaseSeconds(
                        env.TEEHO_AGENT_TIMEOUT_SECONDS,
                    ),
                })
                lease = {
                    userId: input.userId,
                    sessionId: claim.sessionId,
                    generation: claim.generation,
                    browserInstanceId: claim.browserInstanceId,
                    leaseId: claim.leaseId,
                }
                await input.onClaimed?.()
                if (enforceLimits) {
                    const before = createConversationBudgetSnapshot(
                        entitlementSnapshot,
                        claim.consumedTokens,
                    )
                    if (before?.exhausted) {
                        throw new AnalysisConversationBudgetExhaustedError()
                    }
                }
                const claimedSessionId = claim.sessionId
                let tokenDelta = 0
                let value: T
                let usedFallback = false
                let settledRollingUsage: AnalysisRollingUsageStatus
                try {
                    const executeUsageCall = async (call: ManagedUsageCall<T>) => {
                        try {
                            const tracked = await usage.execute({
                                ...call,
                                userId: input.userId,
                                association: { kind: 'conversation', id: claimedSessionId },
                                fallbackTokenCount: input.estimatedTokenCount,
                            })
                            tokenDelta += normalizedTokenCount(
                                tracked.metadata?.usage?.totalTokens,
                                input.estimatedTokenCount,
                            )
                            return tracked
                        } catch (error) {
                            tokenDelta += providerTokenCount(error, input.estimatedTokenCount)
                            throw error
                        }
                    }
                    let tracked: Awaited<ReturnType<typeof executeUsageCall>>
                    try {
                        tracked = await executeUsageCall(input.usageCall)
                    } catch (error) {
                        if (!input.retryUsageCall || !input.usageCall.shouldRetry(error)) {
                            throw error
                        }
                        tracked = await executeUsageCall(input.retryUsageCall)
                    }
                    value = tracked.value
                    settledRollingUsage = enforceLimits
                        ? await rollingUsage.inspect(input.userId, entitlementSnapshot)
                        : {
                              consumedTokens: 0,
                              limitTokens: 0,
                              ...unrestrictedRollingUsage,
                          }
                } catch (error) {
                    tokenDelta = Math.max(tokenDelta, Math.trunc(input.estimatedTokenCount))
                    settledRollingUsage = enforceLimits
                        ? await rollingUsage.inspect(input.userId, entitlementSnapshot)
                        : {
                              consumedTokens: 0,
                              limitTokens: 0,
                              ...unrestrictedRollingUsage,
                          }
                    const failedTurnBudget = enforceLimits
                        ? createConversationBudgetSnapshot(
                              entitlementSnapshot,
                              claim.consumedTokens + tokenDelta,
                          )
                        : null
                    if (
                        !enforceLimits ||
                        (!settledRollingUsage.exhausted &&
                            (!(error instanceof AgentContractError) ||
                                !failedTurnBudget?.exhausted))
                    ) {
                        throw error
                    }
                    value = input.fallback()
                    usedFallback = true
                }
                const projected = enforceLimits
                    ? createConversationBudgetSnapshot(
                          entitlementSnapshot,
                          claim.consumedTokens + tokenDelta,
                      )
                    : null
                if ((projected?.exhausted || settledRollingUsage.exhausted) && !usedFallback) {
                    value = input.forceFinalize(value)
                }
                const settledClaim = claim
                const settledOutcome = (consumedTokens: number): SettledConversationTurn<T> => ({
                    value,
                    session: {
                        sessionId: settledClaim.sessionId,
                        generation: settledClaim.generation,
                        browserInstanceId: settledClaim.browserInstanceId,
                    },
                    budget: enforceLimits
                        ? createConversationBudgetSnapshot(entitlementSnapshot, consumedTokens)
                        : null,
                    rollingUsage: enforceLimits
                        ? publicRollingUsage(settledRollingUsage)
                        : unrestrictedRollingUsage,
                })
                const completedTurn = await settlement.completeAndCommit(
                    {
                        ...lease,
                        contentKind: input.authority.contentKind,
                        tokenDelta,
                    },
                    reservationId,
                    async (executor, consumedTokens) => {
                        await input.onSettled?.(executor, settledOutcome(consumedTokens))
                    },
                )
                if (!completedTurn.completed || completedTurn.consumedTokens === null) {
                    throw new AnalysisConversationStaleError()
                }
                settled = true
                return settledOutcome(completedTurn.consumedTokens)
            } finally {
                if (reservationId && !settled) {
                    await sendWindow.release(input.userId, reservationId).catch(() => undefined)
                }
                if (lease && !settled) {
                    await control.release(lease).catch(() => false)
                }
            }
        },

        async resetAfterTaskAdmission(userId: string) {
            await Promise.all([sendWindow.clear(userId), control.resetAfterTaskAdmission(userId)])
        },
    }
}

export const analysisTokenManagementService = createAnalysisTokenManagementService()
export type AnalysisTokenManagementService = typeof analysisTokenManagementService
