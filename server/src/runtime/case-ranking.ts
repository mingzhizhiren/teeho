import { scorePerformance } from '@teeho/content-metrics'

let rankCases: typeof scorePerformance = scorePerformance
let policyVersion = 'community-observed-interactions.v1'

/** 公共默认使用可解释观察量排序，私有版本可绑定自己的案例表现算法。 */
export function configureCaseRanking(
    value: typeof scorePerformance,
    version = 'custom-observed-policy',
): void {
    rankCases = value
    policyVersion = version
}

/** 随报告冻结选样政策身份，不随后续部署更新历史。 */
export function readCaseRankingVersion(): string {
    return policyVersion
}

export const scoreCasePerformance: typeof scorePerformance = (...args) => rankCases(...args)
