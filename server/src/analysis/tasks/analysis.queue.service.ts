import { withTransaction } from '../../db/database'
import { getTaskPolicy } from '../../runtime/task-policy'
import { analysisExecutionConstraints } from '../analysis.constants'
import {
    claimAnalysisTaskCandidate,
    findNextAnalysisTaskCandidate,
    recoverNextExpiredAnalysisTaskLease,
    type AnalysisTaskClaimOutcome,
} from './analysis.queue.repository'

/**
 * 在同一事务内协调任务领取与积分检查，避免 Repository 反向依赖积分 Service。
 */
export function claimNextAnalysisTask(
    workerId: string,
    processingTimeoutSeconds: number,
    leaseSeconds: number,
): Promise<AnalysisTaskClaimOutcome> {
    return withTransaction(async (transaction) => {
        const candidate = await findNextAnalysisTaskCandidate(transaction, processingTimeoutSeconds)
        if (!candidate) {
            return null
        }

        return {
            kind: 'claimed',
            task: await claimAnalysisTaskCandidate(
                transaction,
                candidate,
                workerId,
                processingTimeoutSeconds,
                leaseSeconds,
            ),
        }
    })
}

/** 逐任务隔离恢复过期租约，并原子释放最终失败任务的积分预留。 */
export async function recoverExpiredAnalysisTaskLeases(
    processingTimeoutSeconds: number,
): Promise<void> {
    while (true) {
        const recovered = await withTransaction(async (transaction) => {
            const task = await recoverNextExpiredAnalysisTaskLease(
                transaction,
                processingTimeoutSeconds,
                analysisExecutionConstraints.maxAutomaticAttempts,
            )
            if (task?.status === 'technical_failed') {
                await getTaskPolicy().release(
                    transaction,
                    task.userId,
                    task.id,
                    task.resultVersion ?? undefined,
                )
            }
            return task
        })
        if (!recovered) {
            return
        }
    }
}
