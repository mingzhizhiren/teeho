import { TIME_MS } from '../../config/constants'
import { withTransaction, type DatabaseExecutor } from '../../db/database'
import { AnalysisPreparationRateError } from '../analysis.errors'
import {
    clearAnalysisDraftSendWindow,
    commitAnalysisDraftSendReservation,
    ensureAnalysisDraftSendWindow,
    insertAnalysisDraftSendReservation,
    lockAnalysisDraftSendWindow,
    releaseAnalysisDraftSendReservation,
    resetAnalysisDraftSendWindow,
} from './analysis.draft-send-window.repository'

interface DraftSendReservationAccepted {
    accepted: true
}

interface DraftSendReservationRejected {
    accepted: false
    retryAfterSeconds: number
    retryAt: string
}

type DraftSendReservationOutcome = DraftSendReservationAccepted | DraftSendReservationRejected

/** 任务草稿发送窗口持久化边界。 */
export interface AnalysisDraftSendWindowPersistence {
    reserve(param: {
        userId: string
        reservationId: string
        windowDurationMs: number
        maxAcceptedSends: number
    }): Promise<DraftSendReservationOutcome>
    commit(userId: string, reservationId: string): Promise<void>
    release(userId: string, reservationId: string): Promise<void>
    clear(userId: string): Promise<void>
}

interface AnalysisDraftSendWindowClock {
    randomUUID: () => string
}

/** 任务草稿发送窗口事务执行边界。 */
export interface AnalysisDraftSendTransactionRunner {
    <T>(callback: (transaction: DatabaseExecutor) => Promise<T>): Promise<T>
}

/** 创建使用真实 PostgreSQL 事务和行锁的草稿发送窗口持久化适配器。 */
export function createPostgresAnalysisDraftSendWindowPersistence(
    runTransaction: AnalysisDraftSendTransactionRunner = (callback) => withTransaction(callback),
): AnalysisDraftSendWindowPersistence {
    return {
        reserve: ({ userId, reservationId, windowDurationMs, maxAcceptedSends }) =>
            runTransaction(async (transaction) => {
                await ensureAnalysisDraftSendWindow(transaction, userId)
                let window = await lockAnalysisDraftSendWindow(transaction, userId)
                const databaseNowMs = Date.parse(window.databaseNow)
                const windowEndsAtMs = Date.parse(window.windowStartedAt) + windowDurationMs
                if (databaseNowMs >= windowEndsAtMs) {
                    await resetAnalysisDraftSendWindow(transaction, userId, window.databaseNow)
                    window = {
                        ...window,
                        windowStartedAt: window.databaseNow,
                        acceptedCount: 0,
                    }
                }
                if (window.acceptedCount >= maxAcceptedSends) {
                    const retryAtMs = Date.parse(window.windowStartedAt) + windowDurationMs
                    return {
                        accepted: false,
                        retryAfterSeconds: Math.ceil(
                            (retryAtMs - Date.parse(window.databaseNow)) / TIME_MS.SECOND,
                        ),
                        retryAt: new Date(retryAtMs).toISOString(),
                    }
                }
                await insertAnalysisDraftSendReservation(transaction, {
                    reservationId,
                    userId,
                })
                return { accepted: true }
            }),
        commit: (userId, reservationId) =>
            runTransaction(async (transaction) => {
                const committed = await commitAnalysisDraftSendReservation(
                    transaction,
                    userId,
                    reservationId,
                )
                if (!committed) {
                    throw new Error('草稿发送占位无法提交')
                }
            }),
        release: (userId, reservationId) =>
            runTransaction(async (transaction) => {
                await releaseAnalysisDraftSendReservation(transaction, userId, reservationId)
            }),
        clear: (userId) =>
            runTransaction(async (transaction) => {
                await clearAnalysisDraftSendWindow(transaction, userId)
            }),
    }
}

const postgresDraftSendWindowPersistence = createPostgresAnalysisDraftSendWindowPersistence()

const systemDraftSendWindowClock: AnalysisDraftSendWindowClock = {
    randomUUID: () => crypto.randomUUID(),
}

/** 创建任务草稿发送窗口服务的依赖。 */
export interface CreateAnalysisDraftSendWindowServiceOptions {
    persistence?: AnalysisDraftSendWindowPersistence
    clock?: AnalysisDraftSendWindowClock
}

/** 创建 Agent 草稿发送窗口服务。 */
export function createAnalysisDraftSendWindowService(
    options: CreateAnalysisDraftSendWindowServiceOptions = {},
) {
    const persistence = options.persistence ?? postgresDraftSendWindowPersistence
    const clock = options.clock ?? systemDraftSendWindowClock

    return {
        async reserve(
            userId: string,
            constraints: {
                windowDurationMs: number
                maxAcceptedSends: number
            },
        ) {
            const reservationId = clock.randomUUID()
            const outcome = await persistence.reserve({
                userId,
                reservationId,
                ...constraints,
            })
            if (!outcome.accepted) {
                throw new AnalysisPreparationRateError(outcome.retryAfterSeconds, outcome.retryAt)
            }
            return { reservationId }
        },
        commit(userId: string, reservationId: string) {
            return persistence.commit(userId, reservationId)
        },
        release(userId: string, reservationId: string) {
            return persistence.release(userId, reservationId)
        },
        clear(userId: string) {
            return persistence.clear(userId)
        },
    }
}

/** 生产运行时共享的 PostgreSQL 草稿发送窗口服务。 */
export const analysisDraftSendWindowService = createAnalysisDraftSendWindowService()

/** 草稿发送窗口服务的公开调用契约。 */
export type AnalysisDraftSendWindowService = typeof analysisDraftSendWindowService
