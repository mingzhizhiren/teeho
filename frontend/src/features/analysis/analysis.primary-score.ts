import type { AnalysisResult } from './analysis.contract'

/** 历史报告按自身来源显示，不读取当前服务器开关。 */
export function readPrimaryScore(result: AnalysisResult): {
    source: 'insight' | 'radar_average'
    value: number
} {
    if (result.primaryScore) return result.primaryScore
    if (result.insight) return { source: 'insight', value: result.insight.score }
    throw new Error('invalid_primary_score')
}
