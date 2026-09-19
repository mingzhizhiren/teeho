import { scorePerformance } from '@teeho/content-metrics'

let rankCases: typeof scorePerformance = scorePerformance

/** 公共默认使用可解释观察量排序，私有版本可绑定自己的案例表现算法。 */
export function configureCaseRanking(value: typeof scorePerformance): void {
    rankCases = value
}

export const scoreCasePerformance: typeof scorePerformance = (...args) => rankCases(...args)
