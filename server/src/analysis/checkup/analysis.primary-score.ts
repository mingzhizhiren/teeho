import type { CheckupReport } from './analysis.checkup.contract'

/** 读取保存的评分来源；旧版报告唯一来源为洞察模型。 */
export function readPrimaryScore(report: CheckupReport): {
    source: 'insight' | 'radar_average'
    value: number
} {
    if (report.primaryScore) return report.primaryScore
    if (report.insight) return { source: 'insight', value: report.insight.score }
    throw new Error('invalid_primary_score')
}
