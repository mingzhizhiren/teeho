import { radarMetricNames, type RadarAlgorithm } from '../sdk'
import { shapeSchema } from './metrics'

const RULES = { max: 10, decimals: 100, titleLength: 8, bodyLength: 40, paragraphs: 2 } as const
/** 社区示例的简单教学规则，不代表官方预测或质量结论。 */
export const exampleAlgorithms: readonly RadarAlgorithm[] = radarMetricNames.map(
    (dimension): RadarAlgorithm => ({
        id: `example/${dimension}`,
        dimension,
        requires: ['example/shape'],
        evaluate: ({ metric }) => {
            const input = metric('example/shape')
            if (input.status === 'unavailable') return null
            const shape = shapeSchema.parse(input.value)
            const values = {
                topicDemand: shape.bodyLength ? 0.6 : 0,
                titleExpression: shape.titleLength / RULES.titleLength,
                contentDevelopment: shape.bodyLength / RULES.bodyLength,
                readingExperience: shape.paragraphs / RULES.paragraphs,
                interactionPotential: shape.questions ? 0.8 : 0.4,
                distinctiveness: shape.variety,
            }
            return (
                Math.round(Math.min(1, values[dimension]) * RULES.max * RULES.decimals) /
                RULES.decimals
            )
        },
    }),
)
