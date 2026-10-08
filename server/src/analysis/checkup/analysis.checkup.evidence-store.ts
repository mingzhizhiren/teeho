import type { AnalysisEvidenceSet } from '../evidence/analysis.evidence'

/** 每任务只首写完整证据，恢复复用已冻结的模型选择，不覆盖原始快照。 */
export interface AnalysisQuantificationEvidenceStore {
    find(taskId: string, userId: string): Promise<AnalysisEvidenceSet | null>
    freeze(
        taskId: string,
        userId: string,
        evidence: AnalysisEvidenceSet,
    ): Promise<AnalysisEvidenceSet>
}
