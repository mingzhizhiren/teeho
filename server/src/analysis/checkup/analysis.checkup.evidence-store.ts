import type { AnalysisEvidenceSet } from '../evidence/analysis.evidence'

/** 每个任务只有一份冻结笔记证据，重试复用原始事实。 */
export interface AnalysisQuantificationEvidenceStore {
    find(taskId: string, userId: string): Promise<AnalysisEvidenceSet | null>
    freeze(
        taskId: string,
        userId: string,
        evidence: AnalysisEvidenceSet,
    ): Promise<AnalysisEvidenceSet>
}
