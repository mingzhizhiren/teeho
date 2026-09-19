import type { ClaimedAnalysisTask, AnalysisTaskClaimCandidate } from './analysis.queue.contract'
export type { ClaimedAnalysisTask, AnalysisTaskClaimCandidate } from './analysis.queue.contract'
import { sql } from 'drizzle-orm'

import { db, type DatabaseExecutor, type DatabaseTransaction } from '../../db/database'
import { getTaskPolicy, maintenanceClaimAllowedSql } from '../../runtime/task-policy'
import { AnalysisTaskLeaseLostError } from '../analysis.errors'
import { standardAnalysisTaskSchema, type AnalysisFailure } from '../analysis.schema'

/** Worker 领取结果；积分不足时任务已终止且不得调用 Provider。 */
export type AnalysisTaskClaimOutcome =
    | { kind: 'claimed'; task: ClaimedAnalysisTask }
    | { kind: 'insufficient_points'; taskId: string; userId: string }
    | null

/** 单次租约恢复的持久化结果。 */
export interface RecoveredAnalysisTaskLease {
    id: string
    userId: string
    resultVersion: number | null
    status: 'retrying' | 'technical_failed'
}

/** 把队列记录时间统一转换为 ISO 字符串 */
function toIsoString(value: Date | string) {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

/** 统计账号当前占用队列容量的任务。 */
export async function countActiveAnalysisTasks(executor: DatabaseExecutor, userId: string) {
    const rows = await executor.execute<{ count: number | string }>(sql`
        SELECT count(*)::int AS count
        FROM public.analysis_tasks
        WHERE user_id = ${userId}::uuid
            AND status IN ('researching', 'queued', 'processing', 'retrying')
    `)
    return Number(rows[0]?.count ?? 0)
}

/** 在指定事务中读取账号唯一的活动任务标识。 */
export async function findActiveAnalysisTaskId(executor: DatabaseExecutor, userId: string) {
    const rows = await executor.execute<{ id: string }>(sql`
        SELECT id::text AS id
        FROM public.analysis_tasks
        WHERE user_id = ${userId}::uuid
            AND status IN ('researching', 'queued', 'processing', 'retrying')
        ORDER BY created_at DESC
        LIMIT 1
    `)
    return rows[0]?.id ?? null
}

/** 在指定事务中把一个仍处于活动状态的用户任务原子推进为 abandoned。 */
export async function abandonActiveAnalysisTask(
    executor: DatabaseExecutor,
    taskId: string,
    userId: string,
) {
    const rows = await executor.execute<{ id: string }>(sql`
        UPDATE public.analysis_tasks
        SET
            status = 'abandoned',
            started_at = NULL,
            lease_expires_at = NULL,
            worker_id = NULL,
            completed_at = now(),
            updated_at = now()
        WHERE id = ${taskId}::uuid
            AND user_id = ${userId}::uuid
            AND status IN ('researching', 'queued', 'processing', 'retrying')
        RETURNING id::text AS id
    `)
    return Boolean(rows[0])
}

/** 在指定事务中把最终技术失败任务人工重新排队。 */
export async function requeueFailedAnalysisTask(
    executor: DatabaseExecutor,
    taskId: string,
    userId: string,
) {
    const rows = await executor.execute<{ id: string }>(sql`
        UPDATE public.analysis_tasks
        SET
            status = 'queued',
            attempt_count = 0,
            manual_retry_count = manual_retry_count + 1,
            queued_at = now(),
            available_at = now(),
            started_at = NULL,
            lease_expires_at = NULL,
            worker_id = NULL,
            completed_at = NULL,
            failure_code = NULL,
            failure_message = NULL,
            updated_at = now()
        WHERE id = ${taskId}::uuid
            AND user_id = ${userId}::uuid
            AND status = 'technical_failed'
        RETURNING id::text AS id
    `)
    return Boolean(rows[0])
}

/** 使用非阻塞行锁读取一个等待领取的任务候选。 */
export async function findNextAnalysisTaskCandidate(
    executor: DatabaseTransaction,
    timeoutSeconds: number,
): Promise<AnalysisTaskClaimCandidate | null> {
    const readCandidate = getTaskPolicy().readCandidate
    if (readCandidate) return readCandidate(executor, timeoutSeconds)
    const candidates = await executor.execute<{
        id: string
        userId: string
        inputFingerprint: string
        status: 'queued' | 'retrying'
        attemptCount: number | string
        resultVersion: number | string
        pointCost: number | string
        subscriptionTier: string
        standardTask: unknown
    }>(sql`
        SELECT
            task.id::text AS id,
            task.user_id::text AS "userId",
            task.input_fingerprint AS "inputFingerprint",
            task.status,
            task.attempt_count AS "attemptCount",
            (
                SELECT COALESCE(max(result.result_version), 0) + 1
                FROM public.analysis_results AS result
                WHERE result.task_id = task.id
            ) AS "resultVersion",
            0 AS "pointCost",
            'community' AS "subscriptionTier",
            task.standard_task_snapshot AS "standardTask"
        FROM public.analysis_tasks AS task
        WHERE (
            task.status = 'queued'
            OR task.status = 'retrying'
        )
            AND task.available_at <= now()
            AND (
                task.started_at IS NULL
                OR task.started_at + (${timeoutSeconds} * interval '1 second') > now()
            )
            AND NOT EXISTS (
                SELECT 1
                FROM public.analysis_tasks AS active
                WHERE active.user_id = task.user_id
                    AND active.id <> task.id
                    AND active.status IN ('processing', 'retrying')
            )
            AND ${maintenanceClaimAllowedSql()}
            AND pg_try_advisory_xact_lock(hashtextextended(task.user_id::text, 0))
        ORDER BY
            CASE WHEN task.status = 'retrying' THEN 0 ELSE 1 END,
            task.queued_at,
            task.id
        FOR UPDATE OF task SKIP LOCKED
        LIMIT 1
    `)
    const candidate = candidates[0]
    if (!candidate) {
        return null
    }

    return {
        id: candidate.id,
        userId: candidate.userId,
        inputFingerprint: candidate.inputFingerprint,
        status: candidate.status,
        attemptCount: Number(candidate.attemptCount),
        resultVersion: Number(candidate.resultVersion),
        pointCost: Number(candidate.pointCost),
        subscriptionTier: candidate.subscriptionTier,
        standardTask: standardAnalysisTaskSchema.parse(candidate.standardTask),
    }
}

/** 在持有候选行锁的事务中写入 Worker 租约并完成领取。 */
export async function claimAnalysisTaskCandidate(
    executor: DatabaseTransaction,
    candidate: AnalysisTaskClaimCandidate,
    workerId: string,
    processingTimeoutSeconds: number,
    leaseSeconds: number,
): Promise<ClaimedAnalysisTask> {
    const rows = await executor.execute<{
        attemptCount: number | string
        processingStartedAt: Date | string
    }>(sql`
        UPDATE public.analysis_tasks AS task
        SET
            status = CASE
                WHEN task.status = 'retrying' THEN 'retrying'
                ELSE 'processing'
            END,
            attempt_count = task.attempt_count + 1,
            started_at = COALESCE(task.started_at, now()),
            lease_expires_at = LEAST(
                COALESCE(task.started_at, now()) +
                    (${processingTimeoutSeconds} * interval '1 second'),
                now() + (${leaseSeconds} * interval '1 second')
            ),
            worker_id = ${workerId},
            updated_at = now()
        WHERE task.id = ${candidate.id}::uuid
            AND task.user_id = ${candidate.userId}::uuid
            AND task.status = ${candidate.status}
            AND task.attempt_count = ${candidate.attemptCount}
        RETURNING
            task.attempt_count AS "attemptCount",
            task.started_at AS "processingStartedAt"
    `)
    const row = rows[0]
    if (!row) {
        throw new AnalysisTaskLeaseLostError()
    }
    return {
        id: candidate.id,
        userId: candidate.userId,
        inputFingerprint: candidate.inputFingerprint,
        workerId,
        processingStartedAt: toIsoString(row.processingStartedAt),
        attemptCount: Number(row.attemptCount),
        resultVersion: candidate.resultVersion,
        pointCost: candidate.pointCost,
        subscriptionTier: candidate.subscriptionTier,
        standardTask: candidate.standardTask,
    }
}

/** 判断指定 worker 的任务租约是否仍由数据库确认有效。 */
export async function hasActiveAnalysisTaskLease(
    taskId: string,
    userId: string,
    attemptCount: number,
    workerId: string,
): Promise<boolean> {
    const rows = await db.execute<{ active: boolean }>(sql`
        SELECT EXISTS (
            SELECT 1
            FROM public.analysis_tasks
            WHERE id = ${taskId}::uuid
                AND user_id = ${userId}::uuid
                AND status IN ('processing', 'retrying')
                AND attempt_count = ${attemptCount}
                AND worker_id = ${workerId}
                AND lease_expires_at > now()
        ) AS active
    `)
    return rows[0]?.active === true
}

/** 在任务总预算内续租当前 Worker 持有的短租约。 */
export async function renewAnalysisTaskLease(
    executor: DatabaseExecutor,
    taskId: string,
    userId: string,
    attemptCount: number,
    workerId: string,
    processingTimeoutSeconds: number,
    leaseSeconds: number,
): Promise<boolean> {
    const rows = await executor.execute<{ id: string }>(sql`
        UPDATE public.analysis_tasks
        SET
            lease_expires_at = LEAST(
                started_at + (${processingTimeoutSeconds} * interval '1 second'),
                now() + (${leaseSeconds} * interval '1 second')
            ),
            updated_at = now()
        WHERE id = ${taskId}::uuid
            AND user_id = ${userId}::uuid
            AND status IN ('processing', 'retrying')
            AND attempt_count = ${attemptCount}
            AND worker_id = ${workerId}
            AND lease_expires_at > now()
            AND started_at + (${processingTimeoutSeconds} * interval '1 second') > now()
        RETURNING id::text AS id
    `)
    return Boolean(rows[0])
}

/** 第一次可重试失败后为同一任务安排唯一一次自动重试。 */
export async function scheduleAnalysisTaskRetry(
    taskId: string,
    userId: string,
    attemptCount: number,
    workerId: string,
) {
    const rows = await db.execute<{ id: string }>(sql`
        UPDATE public.analysis_tasks
        SET
            status = 'retrying',
            available_at = now() + interval '1 second',
            lease_expires_at = NULL,
            worker_id = NULL,
            updated_at = now()
        WHERE id = ${taskId}::uuid
            AND user_id = ${userId}::uuid
            AND status IN ('processing', 'retrying')
            AND attempt_count = ${attemptCount}
            AND attempt_count = 1
            AND worker_id = ${workerId}
            AND lease_expires_at > now()
        RETURNING id::text AS id
    `)
    if (!rows[0]) {
        throw new AnalysisTaskLeaseLostError()
    }
}

/** 保存最终技术失败；非重试错误允许第一次尝试直接终止。 */
export async function markAnalysisTaskFailed(
    executor: DatabaseExecutor,
    taskId: string,
    userId: string,
    attemptCount: number,
    workerId: string,
    failure: AnalysisFailure,
) {
    const rows = await executor.execute<{ id: string }>(sql`
        UPDATE public.analysis_tasks
        SET
            status = 'technical_failed',
            failure_code = ${failure.code},
            failure_message = ${failure.message},
            started_at = started_at,
            lease_expires_at = NULL,
            worker_id = NULL,
            completed_at = now(),
            updated_at = now()
        WHERE id = ${taskId}::uuid
            AND user_id = ${userId}::uuid
            AND status IN ('processing', 'retrying')
            AND attempt_count = ${attemptCount}
            AND worker_id = ${workerId}
            AND lease_expires_at > now()
        RETURNING id::text AS id
    `)
    if (!rows[0]) {
        throw new AnalysisTaskLeaseLostError()
    }
}

/** 在结果及副作用全部写入后将任务推进为成功。 */
export async function markAnalysisTaskSucceeded(
    executor: DatabaseExecutor,
    taskId: string,
    userId: string,
    attemptCount: number,
    workerId: string,
) {
    const rows = await executor.execute<{ id: string }>(sql`
        UPDATE public.analysis_tasks
        SET
            status = 'succeeded',
            lease_expires_at = NULL,
            worker_id = NULL,
            completed_at = now(),
            updated_at = now()
        WHERE id = ${taskId}::uuid
            AND user_id = ${userId}::uuid
            AND status IN ('processing', 'retrying')
            AND attempt_count = ${attemptCount}
            AND worker_id = ${workerId}
            AND lease_expires_at > now()
        RETURNING id::text AS id
    `)
    if (!rows[0]) {
        throw new AnalysisTaskLeaseLostError()
    }
}

/** 锁定并回收一个超出租约的任务；自动重试不得重新获得完整任务预算。 */
export async function recoverNextExpiredAnalysisTaskLease(
    executor: DatabaseTransaction,
    processingTimeoutSeconds: number,
    maximumAttempts: number,
): Promise<RecoveredAnalysisTaskLease | null> {
    const rows = await executor.execute<{
        id: string
        userId: string
        resultVersion: number | string | null
        status: 'retrying' | 'technical_failed'
    }>(sql`
        WITH candidate AS (
            SELECT id
            FROM public.analysis_tasks
            WHERE status IN ('processing', 'retrying')
                AND (
                    lease_expires_at <= now()
                    OR (
                        lease_expires_at IS NULL
                        AND started_at +
                            (${processingTimeoutSeconds} * interval '1 second') <= now()
                    )
                )
            ORDER BY lease_expires_at NULLS LAST, started_at, id
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        UPDATE public.analysis_tasks AS task
        SET
            status = CASE
                WHEN task.attempt_count < ${maximumAttempts}
                    AND task.started_at +
                        (${processingTimeoutSeconds} * interval '1 second') > now()
                    THEN 'retrying'
                ELSE 'technical_failed'
            END,
            available_at = CASE
                WHEN task.attempt_count < ${maximumAttempts}
                    AND task.started_at +
                        (${processingTimeoutSeconds} * interval '1 second') > now()
                    THEN now() + interval '1 second'
                ELSE task.available_at
            END,
            lease_expires_at = NULL,
            worker_id = NULL,
            failure_code = CASE
                WHEN task.attempt_count < ${maximumAttempts}
                    AND task.started_at +
                        (${processingTimeoutSeconds} * interval '1 second') > now()
                    THEN NULL
                ELSE 'agent_timeout'
            END,
            failure_message = CASE
                WHEN task.attempt_count < ${maximumAttempts}
                    AND task.started_at +
                        (${processingTimeoutSeconds} * interval '1 second') > now()
                    THEN NULL
                ELSE '服务器功能异常'
            END,
            completed_at = CASE
                WHEN task.attempt_count < ${maximumAttempts}
                    AND task.started_at +
                        (${processingTimeoutSeconds} * interval '1 second') > now()
                    THEN NULL
                ELSE now()
            END,
            updated_at = now()
        FROM candidate
        WHERE task.id = candidate.id
        RETURNING
            task.id::text AS id,
            task.user_id::text AS "userId",
            (SELECT coalesce(max(result.result_version), 0) + 1 FROM public.analysis_results result WHERE result.task_id = task.id) AS "resultVersion",
            task.status
    `)
    const recovered = rows[0]
    return recovered
        ? {
              ...recovered,
              resultVersion:
                  recovered.resultVersion === null ? null : Number(recovered.resultVersion),
          }
        : null
}
