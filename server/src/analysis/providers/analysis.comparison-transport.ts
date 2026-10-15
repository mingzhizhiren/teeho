import { toStandardSchema, type StandardSchemaWithJSON } from '@mastra/core/schema'

import {
    comparisonExplanationJsonSchema,
    comparisonExplanationSchema,
} from '../checkup/analysis.comparison-explanation'

/** 模型收到严格完整契约，运行时仅对建议字段独立降级。 */
export function createComparisonExplanationTransportSchema(): StandardSchemaWithJSON {
    const runtime = toStandardSchema(comparisonExplanationSchema)
    return {
        '~standard': {
            ...runtime['~standard'],
            jsonSchema: {
                input: () => comparisonExplanationJsonSchema,
                output: () => comparisonExplanationJsonSchema,
            },
        },
    }
}
