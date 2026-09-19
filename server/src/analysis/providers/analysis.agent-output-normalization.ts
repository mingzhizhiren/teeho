import { checkupAgentResultSchema, roundCheckupScore } from '../checkup/analysis.checkup.contract'

/** 只执行不需要语义判断的输出规范化，并保留额外字段供严格 Schema 拒绝。 */
export function normalizeAgentGeneratedOutput(value: unknown): unknown {
    const parsed = checkupAgentResultSchema.safeParse(value)
    if (!parsed.success) return value
    return {
        ...parsed.data,
        agentMetricEvaluations: Object.fromEntries(
            Object.entries(parsed.data.agentMetricEvaluations).map(([name, evaluation]) => [
                name,
                { ...evaluation, score: roundCheckupScore(evaluation.score) },
            ]),
        ),
    }
}
