/** 六边形从顶部顺时针的永久指标顺序；前端独立拥有该展示契约。 */
import { analysisUiConstraints } from './analysis.constants'
import { radarMetricNames } from './analysis.checkup-contract'

export const analysisRadarMetricOrder = radarMetricNames

export type AnalysisRadarMetric = (typeof analysisRadarMetricOrder)[number]

export interface RadarGeometry {
    centerX: number
    centerY: number
    radius: number
}

export interface RadarPoint {
    x: number
    y: number
}

const radarMetricCount = analysisRadarMetricOrder.length
const maximumRadarScore = analysisUiConstraints.scoreMaximum
const quarterTurnDivisor = 2
const fullCircleRadians = Math.PI + Math.PI
const topAngleRadians = -Math.PI / quarterTurnDivisor
const coordinateDecimalPlaces = 2

function roundCoordinate(value: number): number {
    return Number(value.toFixed(coordinateDecimalPlaces))
}

/** 将六个百分制分数转换为从顶部顺时针排列的 SVG 坐标。 */
export function createRadarPoints(
    scores: readonly number[],
    geometry: Readonly<RadarGeometry>,
): RadarPoint[] {
    if (scores.length !== radarMetricCount) {
        throw new Error('analysis_radar_requires_six_scores')
    }
    return scores.map((score, index) => {
        const boundedScore = Math.max(0, Math.min(maximumRadarScore, score))
        const angle = topAngleRadians + (fullCircleRadians * index) / radarMetricCount
        const distance = geometry.radius * (boundedScore / maximumRadarScore)
        return {
            x: roundCoordinate(geometry.centerX + Math.cos(angle) * distance),
            y: roundCoordinate(geometry.centerY + Math.sin(angle) * distance),
        }
    })
}
