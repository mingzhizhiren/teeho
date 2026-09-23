import type { StandardAnalysisTask } from '../analysis.schema'
import type { AnalysisEvidenceSet } from '../evidence/analysis.evidence'
import { checkupOutputConstraints } from './analysis.checkup.constants'
import type { CheckupReference } from './analysis.checkup.contract'
import {
    checkupReferences,
    mapCheckupReferences,
    type SelectedCheckupNote,
} from './analysis.checkup.selection'
import {
    readSemanticReferenceEvidence,
    semanticReferenceSamples,
} from './analysis.reference-evidence'

const SOURCE_QUOTA = 2

/** SQL 优先占两个名额，语义去重后占两个名额，余量按来源顺序补足。 */
export function selectHybridReferences(
    evidence: AnalysisEvidenceSet,
    samples: readonly SelectedCheckupNote[],
    task: StandardAnalysisTask,
): { references: CheckupReference[]; scoringEvidence: AnalysisEvidenceSet } {
    const sql = checkupReferences(samples)
    const semanticEvidence = readSemanticReferenceEvidence(evidence)
    const semanticSamples = semanticEvidence ? semanticReferenceSamples(semanticEvidence, task) : []
    const semantic = mapCheckupReferences(semanticSamples, 'semantic_similarity')
    const sqlFirst = sql.slice(0, SOURCE_QUOTA)
    const sqlIds = new Set(sqlFirst.map((note) => note.noteId))
    const semanticFirst = semantic.filter((note) => !sqlIds.has(note.noteId)).slice(0, SOURCE_QUOTA)
    const ordered = [...sqlFirst, ...semanticFirst, ...sql, ...semantic]
    const references = ordered
        .filter((note, index) => ordered.findIndex((item) => item.noteId === note.noteId) === index)
        .slice(0, checkupOutputConstraints.maxReferences)
    return {
        references,
        // 评分绑定最终入选来源的快照；统计和差异计算继续使用原始 evidence。
        scoringEvidence: {
            ...evidence,
            notes: references.map((reference) => {
                const source =
                    reference.reason === 'semantic_similarity' ? semanticSamples : samples
                return source.find(({ note }) => note.noteId === reference.noteId)!.note
            }),
        },
    }
}
