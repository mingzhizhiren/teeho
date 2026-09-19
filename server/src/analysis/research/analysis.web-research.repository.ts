import { sql } from 'drizzle-orm'

import { db, type DatabaseExecutor, type DatabaseTransaction } from '../../db/database'
import { maintenanceClaimAllowedSql } from '../../runtime/task-policy'
import { analysisWebResearchConstraints } from '../analysis.constants'
import { AnalysisTaskLeaseLostError } from '../analysis.errors'
import type { StandardAnalysisTask } from '../analysis.schema'
import {
    readWebResearchResult,
    webResearchSnapshotSchema,
    type AnalysisWebResearchResult,
    type AnalysisWebResearchSnapshot,
} from './analysis.web-research'

/** 资料搜集 Worker 对一次完整分析生成取得的唯一租约。 */
export interface ClaimedWebResearchTask {
    id: string
    userId: string
    inputFingerprint: string
    workerId: string
    generationVersion: number
    attemptCount: number
    allocatedTokens: number
    standardTask: StandardAnalysisTask
}

export type WebResearchTaskClaimOutcome = { kind: 'claimed'; task: ClaimedWebResearchTask } | null

export interface WebResearchCandidateRow extends Record<string, unknown> {
    id: string
    userId: string
    inputFingerprint: string
    generationVersion: number | string
    standardTask: unknown
}

/** 使用任务行锁选出尚未完成本代资料快照的 researching 任务。 */
export async function findNextWebResearchCandidate(
    executor: DatabaseTransaction,
): Promise<WebResearchCandidateRow | null> {
    const rows = await executor.execute<WebResearchCandidateRow>(sql`
        SELECT
            task.id::text AS id,
            task.user_id::text AS "userId",
            task.input_fingerprint AS "inputFingerprint",
            generation.generation_version AS "generationVersion",
            task.standard_task_snapshot AS "standardTask"
        FROM public.analysis_tasks AS task
        CROSS JOIN LATERAL (
            SELECT COALESCE(max(result.result_version), 0) + 1 AS generation_version
            FROM public.analysis_results AS result
            WHERE result.task_id = task.id
                AND result.user_id = task.user_id
        ) AS generation
        LEFT JOIN public.analysis_web_research_snapshots AS snapshot
            ON snapshot.task_id = task.id
            AND snapshot.user_id = task.user_id
            AND snapshot.generation_version = generation.generation_version
        WHERE task.status = 'researching'
            AND ${maintenanceClaimAllowedSql()}
            AND task.web_research_enabled = true
            AND (
                snapshot.id IS NULL
                OR (
                    snapshot.status = 'collecting'
                    AND snapshot.lease_expires_at <= now()
                )
            )
            AND pg_try_advisory_xact_lock(hashtextextended(task.user_id::text, 0))
        ORDER BY task.created_at, task.id
        FOR UPDATE OF task SKIP LOCKED
        LIMIT 1
    `)
    return rows[0] ?? null
}

/** 新建或回收同一完整生成版本的 collecting 快照租约。 */
export async function leaseWebResearchSnapshot(
    executor: DatabaseTransaction,
    candidate: WebResearchCandidateRow,
    workerId: string,
    timeoutSeconds: number,
) {
    const rows = await executor.execute<{
        attemptCount: number | string
        allocatedTokens: number | string
    }>(sql`
        INSERT INTO public.analysis_web_research_snapshots (
            task_id,
            user_id,
            generation_version,
            status,
            query_version,
            snapshot_version,
            worker_id,
            lease_expires_at
        )
        VALUES (
            ${candidate.id}::uuid,
            ${candidate.userId}::uuid,
            ${Number(candidate.generationVersion)},
            'collecting',
            ${analysisWebResearchConstraints.queryVersion},
            ${analysisWebResearchConstraints.snapshotVersion},
            ${workerId}::uuid,
            now() + (${timeoutSeconds} * interval '1 second')
        )
        ON CONFLICT (task_id, generation_version) DO UPDATE
        SET
            worker_id = EXCLUDED.worker_id,
            lease_expires_at = EXCLUDED.lease_expires_at,
            updated_at = now()
        WHERE analysis_web_research_snapshots.status = 'collecting'
            AND analysis_web_research_snapshots.lease_expires_at <= now()
        RETURNING
            attempt_count AS "attemptCount",
            allocated_tokens AS "allocatedTokens"
    `)
    const row = rows[0]
    return row
        ? {
              attemptCount: Number(row.attemptCount),
              allocatedTokens: Number(row.allocatedTokens),
          }
        : null
}

/** 在实际调用 Provider 前持久化预留本次 Token 与尝试次数。 */
export async function reserveWebResearchAttempt(
    task: ClaimedWebResearchTask,
    tokenReservation: number,
): Promise<{ attemptCount: number; allocatedTokens: number } | null> {
    const rows = await db.execute<{
        attemptCount: number | string
        allocatedTokens: number | string
    }>(sql`
        UPDATE public.analysis_web_research_snapshots
        SET
            attempt_count = attempt_count + 1,
            allocated_tokens = allocated_tokens + ${tokenReservation},
            updated_at = now()
        WHERE task_id = ${task.id}::uuid
            AND user_id = ${task.userId}::uuid
            AND generation_version = ${task.generationVersion}
            AND status = 'collecting'
            AND worker_id = ${task.workerId}::uuid
            AND lease_expires_at > now()
            AND attempt_count < ${analysisWebResearchConstraints.maxAttempts}
            AND allocated_tokens + ${tokenReservation}
                <= ${analysisWebResearchConstraints.tokenBudget}
        RETURNING
            attempt_count AS "attemptCount",
            allocated_tokens AS "allocatedTokens"
    `)
    const row = rows[0]
    return row
        ? {
              attemptCount: Number(row.attemptCount),
              allocatedTokens: Number(row.allocatedTokens),
          }
        : null
}

/** 在调用方事务内冻结快照并推进正式分析队列。 */
export async function finalizeWebResearchTask(
    executor: DatabaseTransaction,
    task: ClaimedWebResearchTask,
    result: AnalysisWebResearchResult,
    sourceTime: string,
) {
    const parsed = readWebResearchResult(result)
    const parsedSourceTime = new Date(sourceTime).toISOString()
    const rows = await executor.execute<{ id: string }>(sql`
            WITH finalized_snapshot AS (
                UPDATE public.analysis_web_research_snapshots AS snapshot
                SET
                    status = ${parsed.status},
                    summary = ${parsed.summary},
                    key_facts = ${JSON.stringify(parsed.keyFacts)}::jsonb,
                    conflicts = ${JSON.stringify(parsed.conflicts)}::jsonb,
                    adopted_sources = ${JSON.stringify(parsed.sources)}::jsonb,
                    source_time = ${parsedSourceTime}::timestamptz,
                    worker_id = NULL,
                    lease_expires_at = NULL,
                    updated_at = now()
                FROM public.analysis_tasks AS active_task
                WHERE snapshot.task_id = ${task.id}::uuid
                    AND snapshot.user_id = ${task.userId}::uuid
                    AND snapshot.generation_version = ${task.generationVersion}
                    AND snapshot.status = 'collecting'
                    AND snapshot.worker_id = ${task.workerId}::uuid
                    AND snapshot.lease_expires_at > now()
                    AND active_task.id = snapshot.task_id
                    AND active_task.user_id = snapshot.user_id
                    AND active_task.status = 'researching'
                RETURNING snapshot.task_id, snapshot.user_id
            )
            UPDATE public.analysis_tasks AS task
            SET
                status = 'queued',
                queued_at = now(),
                available_at = now(),
                started_at = NULL,
                lease_expires_at = NULL,
                worker_id = NULL,
                updated_at = now()
            FROM finalized_snapshot
            WHERE task.id = finalized_snapshot.task_id
                AND task.user_id = finalized_snapshot.user_id
                AND task.status = 'researching'
            RETURNING task.id::text AS id
    `)
    if (!rows[0]) {
        throw new AnalysisTaskLeaseLostError()
    }
}

interface WebResearchSnapshotRow extends Record<string, unknown> {
    status: string
    summary: string | null
    keyFacts: unknown
    conflicts: unknown
    sources: unknown
    sourceTime: Date | string
    queryVersion: string
    snapshotVersion: string
}

/** 读取某次完整分析生成已经冻结的终态资料快照。 */
export async function findWebResearchSnapshot(
    taskId: string,
    userId: string,
    generationVersion: number,
    executor: DatabaseExecutor = db,
): Promise<AnalysisWebResearchSnapshot | null> {
    const rows = await executor.execute<WebResearchSnapshotRow>(sql`
        SELECT
            status,
            summary,
            key_facts AS "keyFacts",
            conflicts,
            adopted_sources AS sources,
            source_time AS "sourceTime",
            query_version AS "queryVersion",
            snapshot_version AS "snapshotVersion"
        FROM public.analysis_web_research_snapshots
        WHERE task_id = ${taskId}::uuid
            AND user_id = ${userId}::uuid
            AND generation_version <= ${generationVersion}
            AND status IN ('collected', 'no_sources')
        ORDER BY generation_version DESC
        LIMIT 1
    `)
    const row = rows[0]
    if (!row) {
        return null
    }
    return webResearchSnapshotSchema.parse({
        schemaVersion: row.snapshotVersion,
        generationVersion,
        status: row.status,
        summary: row.summary,
        keyFacts: row.keyFacts,
        conflicts: row.conflicts,
        sources: row.sources,
        sourceTime:
            row.sourceTime instanceof Date
                ? row.sourceTime.toISOString()
                : new Date(row.sourceTime).toISOString(),
        queryVersion: row.queryVersion,
        snapshotVersion: row.snapshotVersion,
    })
}

/** 判断联网搜集租约是否仍然有效，供运行中取消监视使用。 */
export async function hasActiveWebResearchTaskLease(
    task: ClaimedWebResearchTask,
): Promise<boolean> {
    const rows = await db.execute<{ active: boolean }>(sql`
        SELECT EXISTS (
            SELECT 1
            FROM public.analysis_web_research_snapshots AS snapshot
            JOIN public.analysis_tasks AS task
                ON task.id = snapshot.task_id
                AND task.user_id = snapshot.user_id
            WHERE snapshot.task_id = ${task.id}::uuid
                AND snapshot.user_id = ${task.userId}::uuid
                AND snapshot.generation_version = ${task.generationVersion}
                AND snapshot.status = 'collecting'
                AND snapshot.worker_id = ${task.workerId}::uuid
                AND snapshot.lease_expires_at > now()
                AND task.status = 'researching'
        ) AS active
    `)
    return rows[0]?.active === true
}
