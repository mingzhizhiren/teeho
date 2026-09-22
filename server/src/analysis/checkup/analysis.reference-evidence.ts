import { analysisEvidenceSetSchema, type AnalysisEvidenceSet } from '../evidence/analysis.evidence'
import type { StandardAnalysisTask } from '../analysis.schema'
import { compareCheckupObservations, type SelectedCheckupNote } from './analysis.checkup.selection'

/** 语义参考冻结在独立扩展中，统计样本仍使用原证据集合。 */
export const SEMANTIC_REFERENCE_KEY = 'teeho/semantic-references'

/** 同一个任务重试复用首次召回事实。 */
export function readSemanticReferenceEvidence(
    evidence: AnalysisEvidenceSet,
): AnalysisEvidenceSet | null {
    const result = analysisEvidenceSetSchema.safeParse(
        evidence.extensions?.[SEMANTIC_REFERENCE_KEY],
    )
    return result.success && result.data.notes.length ? result.data : null
}

/** 语义参考保留截止及数据资格，不继承分类配额、词面或年龄限制。 */
export function semanticReferenceSamples(
    evidence: AnalysisEvidenceSet,
    task: Pick<StandardAnalysisTask, 'contentKind'>,
): SelectedCheckupNote[] {
    const cutoff = Date.parse(evidence.selectedAt)
    const ids = new Set<string>()
    return evidence.notes.flatMap((note) => {
        if (ids.has(note.noteId) || !note.title.trim()) return []
        if (note.noteType && note.noteType !== (task.contentKind === 'video' ? 'video' : 'normal'))
            return []
        if (
            [note.publishedAt, note.observedAt, note.firstImportedAt, note.contentObservedAt].some(
                (time) => time && Date.parse(time) > cutoff,
            )
        )
            return []
        const latest = [...note.observations]
            .filter((item) => Date.parse(item.observedAt) <= cutoff)
            .sort(compareCheckupObservations)[0]
        if (!latest || Date.parse(latest.observedAt) < Date.parse(note.publishedAt)) return []
        if (
            [latest.likes, latest.collects].some(
                (value) => value === null || !Number.isSafeInteger(value) || value < 0,
            )
        )
            return []
        ids.add(note.noteId)
        return [{ note, latest, similarity: note.selectionScore }]
    })
}
