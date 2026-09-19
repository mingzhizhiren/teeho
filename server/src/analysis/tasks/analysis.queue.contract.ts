import type { StandardAnalysisTask } from '../analysis.schema'

/** Worker 原子领取的分析任务。 */
export interface ClaimedAnalysisTask {
    id: string
    userId: string
    inputFingerprint: string
    workerId: string
    processingStartedAt: string
    attemptCount: number
    resultVersion: number
    pointCost: number
    subscriptionTier: string
    standardTask: StandardAnalysisTask
}

/** 事务内已加锁、等待领取的任务候选。 */
export interface AnalysisTaskClaimCandidate {
    id: string
    userId: string
    inputFingerprint: string
    status: 'queued' | 'retrying'
    attemptCount: number
    resultVersion: number
    pointCost: number
    subscriptionTier: string
    standardTask: StandardAnalysisTask
}
