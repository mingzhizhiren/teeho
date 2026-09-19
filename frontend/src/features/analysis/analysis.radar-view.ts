import type { AnalysisResult } from './analysis.contract'
import { radarMetricNames, type RadarScores } from './analysis.checkup-contract'

const MAXIMUM_MISSING = 2
/** 图形隐藏不抹去响应中的已计算维度。 */
export function visibleRadar(result: Pick<AnalysisResult, 'radar'>): RadarScores | null {
    const scores = result.radar
    return scores &&
        radarMetricNames.filter((metric) => scores[metric] === null).length <= MAXIMUM_MISSING
        ? scores
        : null
}
