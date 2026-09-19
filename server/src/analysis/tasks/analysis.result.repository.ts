import { sql } from 'drizzle-orm'
import { readPrimaryScore } from '../checkup/analysis.primary-score'

import { type DatabaseExecutor } from '../../db/database'
import {
    analysisInternalExecutionTraceSchema,
    type AgentAnalysisResult,
    type AnalysisInternalExecutionTrace,
} from '../analysis.schema'

/** 创建不可变分析结果所需的持久化参数。 */
export interface CreateAnalysisResultParam {
    taskId: string
    userId: string
    resultVersion: number
    result: AgentAnalysisResult
    trace: AnalysisInternalExecutionTrace
}

/** 构造仅含核心列和三个 JSONB 的分析结果写入语句。 */
export function buildInsertAnalysisResultQuery(param: CreateAnalysisResultParam) {
    const trace = analysisInternalExecutionTraceSchema.parse(param.trace)
    return sql`
        INSERT INTO public.analysis_results (
            task_id, result_version, user_id, level, result_schema_version,
            checkup_report, internal_execution_trace
        ) VALUES (
            ${param.taskId}::uuid, ${param.resultVersion}, ${param.userId}::uuid,
            ${readPrimaryScore(param.result).value}, ${param.result.schemaVersion},
            ${JSON.stringify(param.result)}::jsonb, ${JSON.stringify(trace)}::jsonb
        )
    `
}

/** 在指定事务中保存一个不可变结果版本。 */
export async function insertAnalysisResult(
    executor: DatabaseExecutor,
    param: CreateAnalysisResultParam,
) {
    await executor.execute(buildInsertAnalysisResultQuery(param))
}
