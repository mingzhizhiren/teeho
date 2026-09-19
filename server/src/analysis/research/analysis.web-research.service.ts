import { withTransaction } from '../../db/database'
import { standardAnalysisTaskSchema } from '../analysis.schema'
import type { AnalysisWebResearchResult } from './analysis.web-research'
import {
    finalizeWebResearchTask,
    findNextWebResearchCandidate,
    leaseWebResearchSnapshot,
    type ClaimedWebResearchTask,
    type WebResearchTaskClaimOutcome,
} from './analysis.web-research.repository'

/** 在同一事务内领取任务行并创建或回收对应生成版本的资料快照租约。 */
export function claimNextWebResearchTask(
    workerId: string,
    timeoutSeconds: number,
): Promise<WebResearchTaskClaimOutcome> {
    return withTransaction(async (transaction) => {
        const candidate = await findNextWebResearchCandidate(transaction)
        if (!candidate) {
            return null
        }
        const lease = await leaseWebResearchSnapshot(
            transaction,
            candidate,
            workerId,
            timeoutSeconds,
        )
        if (!lease) {
            return null
        }
        return {
            kind: 'claimed' as const,
            task: {
                id: candidate.id,
                userId: candidate.userId,
                inputFingerprint: candidate.inputFingerprint,
                workerId,
                generationVersion: Number(candidate.generationVersion),
                attemptCount: lease.attemptCount,
                allocatedTokens: lease.allocatedTokens,
                standardTask: standardAnalysisTaskSchema.parse(candidate.standardTask),
            },
        }
    })
}

/** 原子冻结联网快照并把仍处于 researching 的任务推进到正式分析队列。 */
export function completeWebResearchTask(
    task: ClaimedWebResearchTask,
    result: AnalysisWebResearchResult,
    sourceTime: string,
) {
    return withTransaction((transaction) =>
        finalizeWebResearchTask(transaction, task, result, sourceTime),
    )
}
