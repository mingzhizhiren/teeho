import { lockAccountOperations } from '../../account/account-operation.lock'
import { withTransaction, type DatabaseExecutor } from '../../db/database'
import { logger } from '../../utils/logger'
import {
    analysisConversationTurnRunRepository,
    type AnalysisConversationTurnRunIdentity,
} from './analysis.conversation-turn-run.repository'
import {
    analysisConversationTurnResultSchema,
    type AnalysisConversationSessionIdentity,
    type AnalysisConversationTurnResult,
} from './analysis.conversation.contract'
import {
    AnalysisConversationBusyError,
    AnalysisConversationStaleError,
} from './analysis.conversation.repository'

interface AnalysisConversationTurnRunPort {
    beginInTransaction(
        executor: DatabaseExecutor,
        input: AnalysisConversationTurnRunIdentity,
        authSessionKey: string,
    ): ReturnType<typeof analysisConversationTurnRunRepository.beginInTransaction>
    completeInTransaction(
        executor: DatabaseExecutor,
        input: AnalysisConversationTurnRunIdentity,
        result: AnalysisConversationTurnResult,
    ): Promise<boolean>
    renew(input: AnalysisConversationTurnRunIdentity): Promise<boolean>
    fail(input: AnalysisConversationTurnRunIdentity): Promise<void>
    find(
        input: AnalysisConversationTurnRunIdentity,
    ): ReturnType<typeof analysisConversationTurnRunRepository.find>
    acknowledge(input: AnalysisConversationTurnRunIdentity): Promise<boolean>
    invalidate(
        input: Parameters<typeof analysisConversationTurnRunRepository.invalidate>[0],
    ): Promise<number>
    invalidateInTransaction(
        executor: DatabaseExecutor,
        input: Parameters<typeof analysisConversationTurnRunRepository.invalidate>[0],
    ): Promise<number>
    blockAuthSession(
        executor: DatabaseExecutor,
        userId: string,
        authSessionKey: string,
    ): Promise<void>
}

function identity(
    userId: string,
    turnId: string,
    session: AnalysisConversationSessionIdentity,
): AnalysisConversationTurnRunIdentity {
    return { userId, turnId, ...session }
}

/** 创建刷新可恢复、但不持久化请求正文的临时回合模块。 */
export function createAnalysisConversationTurnRunService(
    repository: AnalysisConversationTurnRunPort = analysisConversationTurnRunRepository,
    transactionRunner: typeof withTransaction = withTransaction,
    lockAccount: typeof lockAccountOperations = lockAccountOperations,
) {
    const invalidateUser = (userId: string, authSessionKey: string) =>
        transactionRunner(async (transaction) => {
            await lockAccount(transaction, userId)
            await repository.blockAuthSession(transaction, userId, authSessionKey)
            return repository.invalidateInTransaction(transaction, {
                userId,
                reason: 'logged_out',
            })
        })

    return {
        async execute(
            userId: string,
            authSessionKey: string,
            turnId: string,
            session: AnalysisConversationSessionIdentity,
            operation: (
                renewLease: () => Promise<void>,
                settleResult: (
                    executor: DatabaseExecutor,
                    result: AnalysisConversationTurnResult,
                ) => Promise<void>,
            ) => Promise<{ result: AnalysisConversationTurnResult }>,
        ) {
            const runIdentity = identity(userId, turnId, session)
            const run = await transactionRunner(async (transaction) => {
                await lockAccount(transaction, userId)
                return repository.beginInTransaction(transaction, runIdentity, authSessionKey)
            })
            if (!run) throw new AnalysisConversationStaleError()
            if (!run.created) {
                if (run.status === 'completed') {
                    return { result: analysisConversationTurnResultSchema.parse(run.resultPayload) }
                }
                if (run.status === 'processing') throw new AnalysisConversationBusyError()
                throw new AnalysisConversationStaleError()
            }
            try {
                let mailboxSettled = false
                const outcome = await operation(
                    async () => {
                        if (!(await repository.renew(runIdentity))) {
                            throw new AnalysisConversationStaleError()
                        }
                    },
                    async (executor, result) => {
                        const parsedResult = analysisConversationTurnResultSchema.parse(result)
                        if (
                            !(await repository.completeInTransaction(
                                executor,
                                runIdentity,
                                parsedResult,
                            ))
                        ) {
                            throw new AnalysisConversationStaleError()
                        }
                        mailboxSettled = true
                    },
                )
                const result = analysisConversationTurnResultSchema.parse(outcome.result)
                if (!mailboxSettled) throw new Error('Agent 回合结果未进入原子结算')
                return { result }
            } catch (error) {
                await repository.fail(runIdentity)
                throw error
            }
        },

        async recover(
            userId: string,
            turnId: string,
            session: AnalysisConversationSessionIdentity,
        ) {
            const run = await repository.find(identity(userId, turnId, session))
            if (!run) return { turnId, status: 'missing' as const }
            if (run.status === 'completed') {
                return {
                    turnId,
                    status: 'completed' as const,
                    result: analysisConversationTurnResultSchema.parse(run.resultPayload),
                }
            }
            if (run.status === 'cancelled') {
                return {
                    turnId,
                    status: 'cancelled' as const,
                    reason:
                        run.failureReason === 'logged_out'
                            ? ('logged_out' as const)
                            : ('conversation_cleared' as const),
                }
            }
            return { turnId, status: run.status }
        },

        acknowledge(userId: string, turnId: string, session: AnalysisConversationSessionIdentity) {
            return repository.acknowledge(identity(userId, turnId, session))
        },

        invalidateSession(userId: string, session: AnalysisConversationSessionIdentity) {
            return repository.invalidate({
                userId,
                ...session,
                reason: 'conversation_cleared',
            })
        },

        invalidateUser,

        invalidateUserBestEffort(userId: string, authSessionKey: string) {
            void invalidateUser(userId, authSessionKey).catch((error: unknown) => {
                logger.warn(
                    {
                        event: 'analysis_conversation_turn_logout_invalidation_failed',
                        errorName: error instanceof Error ? error.name : 'UnknownError',
                    },
                    '退出账号时临时 Agent 回合失效失败',
                )
            })
        },
    }
}

export const analysisConversationTurnRunService = createAnalysisConversationTurnRunService()
