import { sql } from 'drizzle-orm'

import { db, type DatabaseExecutor } from '../../db/database'
import { logger } from '../../utils/logger'
import { getTaskPolicy } from '../../runtime/task-policy'
import { analysisExecutionConstraints } from '../analysis.constants'
import type { AnalysisFingerprints } from '../analysis.fingerprints'
import { analysisFingerprintConstraints } from '../analysis.fingerprints.constants'
import {
    agentAnalysisResultSchema,
    analysisFailureSchema,
    analysisInputModeSchema,
    analysisTaskStatusSchema,
    standardAnalysisTaskSchema,
    type AgentAnalysisResult,
    type AnalysisFailure,
    type AnalysisInputMode,
    type AnalysisTaskStatus,
    type StandardAnalysisTask,
} from '../analysis.schema'

/** API 可读取的持久化分析任务；只包含最新成功结果。 */
export interface AnalysisTaskRecord {
    id: string
    inputMode: AnalysisInputMode
    inputFingerprint: string
    status: AnalysisTaskStatus
    structureConfigVersion: string
    standardTask: StandardAnalysisTask
    result: AgentAnalysisResult | null
    resultVersion: number | null
    failure: AnalysisFailure | null
    pointCost: number
    chargedPoints?: number | null
    attemptCount: number
    manualRetryCount: number
    queuePosition: number | null
    expectedDurationSeconds: number
    createdAt: string
    queuedAt: string
    startedAt: string | null
    updatedAt: string
    completedAt: string | null
    cancellationReason?: 'maintenance' | 'refund' | null
}

interface AnalysisTaskDatabaseRow extends Record<string, unknown> {
    id: string
    inputMode: string
    inputFingerprint: string
    status: string
    structureConfigVersion: string
    standardTask: unknown
    pointCost: number | string
    failureCode: string | null
    failureMessage: string | null
    cancellationReason: 'maintenance' | 'refund' | null
    attemptCount: number | string
    manualRetryCount: number | string
    queuePosition: number | string | null
    createdAt: Date | string
    queuedAt: Date | string
    startedAt: Date | string | null
    updatedAt: Date | string
    completedAt: Date | string | null
    resultVersion: number | string | null
    checkupReport: unknown
}

/** 插入排队任务所需的持久化参数。 */
export interface InsertResearchingAnalysisTaskParam {
    taskId: string
    userId: string
    inputMode: AnalysisInputMode
    inputFingerprint: string
    fingerprints: AnalysisFingerprints
    standardTask: StandardAnalysisTask
    webResearchEnabled: boolean
}

/** 已存在提交的持久化身份。 */
export interface AnalysisTaskSubmission extends Record<string, unknown> {
    id: string
    inputFingerprint: string
}

export interface ReanalyzableAnalysisTask {
    inputMode: AnalysisInputMode
    inputFingerprint: string
    fingerprints: AnalysisFingerprints
    standardTask: StandardAnalysisTask
}

export interface FailedAnalysisTask {
    standardTask: StandardAnalysisTask
    resultVersion: number
}

/** 把任务记录时间统一转换为 ISO 字符串 */
function toIsoString(value: Date | string) {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

/** 把数据库任务记录映射为领域对象 */
function mapAnalysisTask(row: AnalysisTaskDatabaseRow): AnalysisTaskRecord | null {
    const standardTask = standardAnalysisTaskSchema.parse(row.standardTask)
    const failure =
        row.failureCode === null
            ? null
            : analysisFailureSchema.parse({
                  code: row.failureCode,
                  message: row.failureMessage,
              })
    const parsedResult =
        row.resultVersion === null ? null : agentAnalysisResultSchema.safeParse(row.checkupReport)
    if (parsedResult && !parsedResult.success) {
        logger.warn(
            {
                event: 'stored_analysis_result_unreadable',
                taskId: row.id,
                issueCodes: parsedResult.error.issues.map((issue) => issue.code),
            },
            '已隔离不符合当前契约的分析报告',
        )
        // 不恢复旧指标，也不修改持久化状态；一条旧报告不能阻断其它任务。
        if (row.status === 'succeeded') return null
    }
    const result = parsedResult?.success ? parsedResult.data : null

    return {
        id: row.id,
        inputMode: analysisInputModeSchema.parse(row.inputMode),
        inputFingerprint: row.inputFingerprint,
        status: analysisTaskStatusSchema.parse(row.status),
        structureConfigVersion: row.structureConfigVersion,
        standardTask,
        result,
        resultVersion: row.resultVersion === null ? null : Number(row.resultVersion),
        failure,
        pointCost: Number(row.pointCost),
        chargedPoints: row.pointReservationStatus === 'settled' ? Number(row.pointCost) : null,
        attemptCount: Number(row.attemptCount),
        manualRetryCount: Number(row.manualRetryCount),
        queuePosition: row.queuePosition === null ? null : Number(row.queuePosition),
        expectedDurationSeconds: analysisExecutionConstraints.expectedDurationWithImagesSeconds,
        createdAt: toIsoString(row.createdAt),
        queuedAt: toIsoString(row.queuedAt),
        startedAt: row.startedAt ? toIsoString(row.startedAt) : null,
        updatedAt: toIsoString(row.updatedAt),
        completedAt: row.completedAt ? toIsoString(row.completedAt) : null,
        cancellationReason: row.cancellationReason,
    }
}

/** 在调用方事务中取得账号级分析任务锁。 */
export async function lockAnalysisTaskAccount(
    executor: DatabaseExecutor,
    userId: string,
): Promise<void> {
    await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}::text, 0))`)
}

/** 在调用方事务中读取同一提交标识的已有任务。 */
export async function findAnalysisTaskSubmission(
    executor: DatabaseExecutor,
    taskId: string,
    userId: string,
): Promise<AnalysisTaskSubmission | null> {
    const rows = await executor.execute<AnalysisTaskSubmission>(sql`
        SELECT
            id::text AS id,
            input_fingerprint AS "inputFingerprint"
        FROM public.analysis_tasks
        WHERE id = ${taskId}::uuid
            AND user_id = ${userId}::uuid
        LIMIT 1
    `)
    return rows[0] ?? null
}

/** 在调用方事务中插入一个等待资料搜集的正式任务。 */
export async function insertResearchingAnalysisTask(
    executor: DatabaseExecutor,
    param: InsertResearchingAnalysisTaskParam,
) {
    const rows = await executor.execute<{ id: string }>(sql`
        INSERT INTO public.analysis_tasks (
            id,
            user_id,
            input_mode,
            input_fingerprint,
            quantification_fingerprint,
            level_fingerprint,
            generation_fingerprint,
            status,
            queued_at,
            structure_config_version,
            standard_task_snapshot,
            web_research_enabled
            ${getTaskPolicy().insertColumns()}
        )
        VALUES (
            ${param.taskId}::uuid,
            ${param.userId}::uuid,
            ${param.inputMode},
            ${param.inputFingerprint},
            ${param.fingerprints.quantification},
            ${param.fingerprints.level},
            ${param.fingerprints.generation},
            ${param.webResearchEnabled ? 'researching' : 'queued'},
            now(),
            ${param.standardTask.structureVersion},
            ${JSON.stringify(param.standardTask)}::jsonb,
            ${param.webResearchEnabled}
            ${getTaskPolicy().insertValues(param.standardTask)}
        )
        RETURNING id::text AS id
    `)
    const taskId = rows[0]?.id
    if (!taskId) {
        throw new Error('创建分析任务后未返回任务标识')
    }
    return taskId
}

/** 锁定并读取可创建全新重新分析任务的成功快照。 */
export async function findReanalyzableAnalysisTask(
    executor: DatabaseExecutor,
    taskId: string,
    userId: string,
): Promise<ReanalyzableAnalysisTask | null> {
    const rows = await executor.execute<{
        inputMode: string
        inputFingerprint: string
        quantificationFingerprint: string
        levelFingerprint: string
        generationFingerprint: string
        standardTask: unknown
    }>(sql`
        SELECT
            task.input_mode AS "inputMode",
            task.input_fingerprint AS "inputFingerprint",
            task.quantification_fingerprint AS "quantificationFingerprint",
            task.level_fingerprint AS "levelFingerprint",
            task.generation_fingerprint AS "generationFingerprint",
            task.standard_task_snapshot AS "standardTask"
        FROM public.analysis_tasks AS task
        WHERE task.id = ${taskId}::uuid
            AND task.user_id = ${userId}::uuid
            AND task.status = 'succeeded'
            AND EXISTS (
                SELECT 1
                FROM public.analysis_results AS result
                WHERE result.task_id = task.id
                    AND result.user_id = task.user_id
            )
        FOR UPDATE
    `)
    const row = rows[0]
    return row
        ? {
              inputMode: analysisInputModeSchema.parse(row.inputMode),
              inputFingerprint: row.inputFingerprint,
              fingerprints: {
                  schemaVersion: analysisFingerprintConstraints.fingerprintVersion,
                  quantification: row.quantificationFingerprint,
                  level: row.levelFingerprint,
                  generation: row.generationFingerprint,
              },
              standardTask: standardAnalysisTaskSchema.parse(row.standardTask),
          }
        : null
}

/** 锁定并读取一个最终技术失败任务的快照。 */
export async function findFailedAnalysisTask(
    executor: DatabaseExecutor,
    taskId: string,
    userId: string,
): Promise<FailedAnalysisTask | null> {
    const rows = await executor.execute<{
        standardTask: unknown
        resultVersion: number | string
    }>(sql`
        SELECT
            task.standard_task_snapshot AS "standardTask",
            (
                    SELECT coalesce(max(result.result_version), 0) + 1
                    FROM public.analysis_results AS result
                    WHERE result.task_id = task.id
                        AND result.user_id = task.user_id
            ) AS "resultVersion"
        FROM public.analysis_tasks AS task
        WHERE task.id = ${taskId}::uuid
            AND task.user_id = ${userId}::uuid
            AND task.status = 'technical_failed'
        FOR UPDATE
    `)
    return rows[0]
        ? {
              standardTask: standardAnalysisTaskSchema.parse(rows[0].standardTask),
              resultVersion: Number(rows[0].resultVersion),
          }
        : null
}

/** 生成读取分析任务所需的公共字段列表 */
function analysisTaskSelect(
    condition: ReturnType<typeof sql>,
    limit: number,
    executor: DatabaseExecutor = db,
) {
    return executor.execute<AnalysisTaskDatabaseRow>(sql`
        WITH selected_tasks AS (
            SELECT
                task.*,
                CASE
                    WHEN task.status = 'queued' THEN (
                        SELECT count(*)::int
                        FROM public.analysis_tasks AS ahead
                        WHERE ahead.user_id = task.user_id
                            AND ahead.status = 'queued'
                            AND (ahead.queued_at, ahead.id) <= (task.queued_at, task.id)
                    )
                    ELSE NULL
                END AS queue_position
            FROM public.analysis_tasks AS task
            WHERE ${condition}
                AND (task.status <> 'succeeded' OR EXISTS (
                    SELECT 1 FROM public.analysis_results current_result
                    WHERE current_result.task_id = task.id AND current_result.user_id = task.user_id
                        AND current_result.result_schema_version IN ('analysis-result.v6', 'analysis-result.v7')
                ))
            ORDER BY task.created_at DESC
            LIMIT ${limit}
        )
        SELECT
            task.id::text AS "id",
            task.input_mode AS "inputMode",
            task.input_fingerprint AS "inputFingerprint",
            task.status,
            task.structure_config_version AS "structureConfigVersion",
            task.standard_task_snapshot AS "standardTask",
            ${getTaskPolicy().taskReadProjection()},
            task.failure_code AS "failureCode",
            task.failure_message AS "failureMessage",
            task.cancellation_reason AS "cancellationReason",
            task.attempt_count AS "attemptCount",
            task.manual_retry_count AS "manualRetryCount",
            task.queue_position AS "queuePosition",
            task.created_at AS "createdAt",
            task.queued_at AS "queuedAt",
            task.started_at AS "startedAt",
            task.updated_at AS "updatedAt",
            task.completed_at AS "completedAt",
            result.result_version AS "resultVersion",
            result.checkup_report AS "checkupReport"
        FROM selected_tasks AS task
        LEFT JOIN LATERAL (
            SELECT result.*
            FROM public.analysis_results AS result
            WHERE result.task_id = task.id
                AND result.user_id = task.user_id
            ORDER BY result.result_version DESC
            LIMIT 1
        ) AS result ON true
        ORDER BY task.created_at DESC
    `)
}

/** 按任务标识读取当前用户自己的任务，不重新调用 Provider。 */
export async function findAnalysisTaskById(
    userId: string,
    taskId: string,
): Promise<AnalysisTaskRecord | null> {
    const rows = await analysisTaskSelect(
        sql`task.id = ${taskId}::uuid AND task.user_id = ${userId}::uuid`,
        1,
    )
    return rows[0] ? mapAnalysisTask(rows[0]) : null
}

/** 按有效输入读取当前账号尚未结束的任务，用于跨刷新提交幂等。 */
export async function findActiveAnalysisTaskByFingerprint(
    userId: string,
    inputFingerprint: string,
): Promise<AnalysisTaskRecord | null> {
    const rows = await analysisTaskSelect(
        sql`
            task.user_id = ${userId}::uuid
            AND task.input_fingerprint = ${inputFingerprint}
            AND task.status IN ('researching', 'queued', 'processing', 'retrying')
        `,
        1,
    )
    return rows[0] ? mapAnalysisTask(rows[0]) : null
}

/** 读取账号唯一活动任务，用于正式提交响应未知后的幂等恢复。 */
export async function findActiveAnalysisTask(userId: string): Promise<AnalysisTaskRecord | null> {
    const rows = await analysisTaskSelect(
        sql`
            task.user_id = ${userId}::uuid
            AND task.status IN ('researching', 'queued', 'processing', 'retrying')
        `,
        1,
    )
    return rows[0] ? mapAnalysisTask(rows[0]) : null
}

/** 读取当前用户最近创建的任务。 */
export async function findLatestAnalysisTask(userId: string): Promise<AnalysisTaskRecord | null> {
    const rows = await analysisTaskSelect(sql`task.user_id = ${userId}::uuid`, 1)
    return rows[0] ? mapAnalysisTask(rows[0]) : null
}

/** 读取工作台最近任务列表。 */
export async function findAnalysisTasks(
    userId: string,
    limit = analysisExecutionConstraints.taskListLimit,
) {
    const rows = await analysisTaskSelect(sql`task.user_id = ${userId}::uuid`, limit)
    return rows.flatMap((row) => {
        const task = mapAnalysisTask(row)
        return task ? [task] : []
    })
}
