import { TIME_MS } from '../../config/constants'
import type { AgentAccessSnapshot } from '../../runtime/agent-policy'
import {
    findAnalysisRollingUsage,
    type AnalysisRollingUsageRecord,
} from './analysis.rolling-usage.repository'

export interface AnalysisRollingUsageStatus {
    consumedTokens: number
    limitTokens: number
    exhausted: boolean
    retryAt: string | null
    retryAfterSeconds: number
    canUpgrade: boolean
}

export interface AnalysisRollingUsagePersistence {
    read(userId: string, windowSeconds: number): Promise<AnalysisRollingUsageRecord>
}

interface CreateAnalysisRollingUsageServiceOptions {
    persistence?: AnalysisRollingUsagePersistence
}

const postgresRollingUsagePersistence: AnalysisRollingUsagePersistence = {
    read: findAnalysisRollingUsage,
}

function recoveryTime(
    record: AnalysisRollingUsageRecord,
    limitTokens: number,
    windowSeconds: number,
) {
    let remaining = record.calls.reduce((sum, call) => sum + call.tokenCount, 0)
    if (remaining < limitTokens) return null
    for (const call of record.calls) {
        remaining -= call.tokenCount
        if (remaining < limitTokens) {
            return new Date(
                Date.parse(call.startedAt) + windowSeconds * TIME_MS.SECOND,
            ).toISOString()
        }
    }
    return null
}

/** 创建滚动账号额度计算器；数据库负责筛选权威时间窗口，服务负责纯额度决策。 */
export function createAnalysisRollingUsageService(
    options: CreateAnalysisRollingUsageServiceOptions = {},
) {
    const persistence = options.persistence ?? postgresRollingUsagePersistence
    return {
        async inspect(userId: string, entitlement: AgentAccessSnapshot) {
            const { rollingWindowSeconds, rollingTokenLimit } = entitlement.agentPolicy
            const record = await persistence.read(userId, rollingWindowSeconds)
            const consumedTokens = record.calls.reduce((sum, call) => sum + call.tokenCount, 0)
            const exhausted = consumedTokens >= rollingTokenLimit
            const retryAt = exhausted
                ? recoveryTime(record, rollingTokenLimit, rollingWindowSeconds)
                : null
            return {
                consumedTokens,
                limitTokens: rollingTokenLimit,
                exhausted,
                retryAt,
                retryAfterSeconds: retryAt
                    ? Math.max(
                          1,
                          Math.ceil(
                              (Date.parse(retryAt) - Date.parse(record.databaseNow)) /
                                  TIME_MS.SECOND,
                          ),
                      )
                    : 0,
                canUpgrade: entitlement.canUpgrade ?? false,
            } satisfies AnalysisRollingUsageStatus
        },
    }
}

export const analysisRollingUsageService = createAnalysisRollingUsageService()
export type AnalysisRollingUsageService = typeof analysisRollingUsageService
