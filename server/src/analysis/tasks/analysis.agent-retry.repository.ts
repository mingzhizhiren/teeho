import { sql } from 'drizzle-orm'
import { db } from '../../db/database'
import { AnalysisTaskLeaseLostError } from '../analysis.errors'
import type { AgentRetryStage } from '../providers/analysis.agent-busy'
import type { ClaimedAnalysisTask } from './analysis.queue.contract'

/** 仅当前有效租约可更新等待阶段；并行封面/正文分别登记，互不覆盖。 */
export async function setAnalysisAgentRetryWaiting(
    task: Pick<ClaimedAnalysisTask, 'id' | 'userId' | 'attemptCount' | 'workerId'>,
    stage: AgentRetryStage,
    waiting: boolean,
): Promise<void> {
    const rows = await db.execute<{ id: string }>(sql`
        UPDATE public.analysis_tasks
        SET agent_retry_waits = CASE WHEN ${waiting}
                THEN array_append(array_remove(agent_retry_waits, ${stage}), ${stage})
                ELSE array_remove(agent_retry_waits, ${stage}) END,
            updated_at = now()
        WHERE id = ${task.id}::uuid AND user_id = ${task.userId}::uuid
            AND status IN ('processing', 'retrying')
            AND attempt_count = ${task.attemptCount} AND worker_id = ${task.workerId}
            AND lease_expires_at > now()
        RETURNING id::text AS id
    `)
    if (!rows[0]) throw new AnalysisTaskLeaseLostError()
}
