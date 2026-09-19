import { PERFORMANCE } from '@teeho/content-metrics'
import { z } from 'zod'
export const radarMetricNames = [
    'topicDemand',
    'titleExpression',
    'contentDevelopment',
    'readingExperience',
    'interactionPotential',
    'distinctiveness',
] as const
export type RadarMetric = (typeof radarMetricNames)[number]
const metricValue = z.number().finite().min(0).max(PERFORMANCE.maxScore).nullable()
export const radarScoresSchema = z
    .object({
        topicDemand: metricValue,
        titleExpression: metricValue,
        contentDevelopment: metricValue,
        readingExperience: metricValue,
        interactionPotential: metricValue,
        distinctiveness: metricValue,
    })
    .strict()
export type RadarScores = z.infer<typeof radarScoresSchema>
/** 所有输出保留两位小数，不生成非有限数。 */
export function roundRadar(value: number): number {
    return (
        Math.round(Math.max(0, Math.min(PERFORMANCE.maxScore, value)) * PERFORMANCE.decimals) /
        PERFORMANCE.decimals
    )
}
