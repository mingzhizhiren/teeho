import { createHash } from 'node:crypto'
import type { InsightPredictor } from '../../runtime/insight'
import type { StandardAnalysisTask } from '../analysis.schema'
import type { AnalysisEvidenceSet } from '../evidence/analysis.evidence'
import { mapCheckupReferences, selectCheckupNotes } from './analysis.checkup.selection'
import {
    readSemanticReferenceEvidence,
    semanticReferenceSamples,
} from './analysis.reference-evidence'
import { scoreCheckupReferences } from './analysis.reference-scoring'
import {
    MODEL_COHORT_KEY,
    MODEL_COHORT_POLICY,
    MODEL_COHORT_LIMITS,
    selectModelCohort,
    type CandidateSource,
} from './analysis.model-cohort'

interface ModelCohortInput {
    readonly evidence: AnalysisEvidenceSet
    readonly task: StandardAnalysisTask
    readonly predict: InsightPredictor
    readonly modelId: string
    readonly signal: AbortSignal
    readonly onUnavailable: (category: string, durationMs: number) => void
}

/** 两路候选统一评分后一次冻结；同篇双命中仅评分一次，模型缺分不参与中位数。 */
export async function prepareModelCohort(input: ModelCohortInput): Promise<AnalysisEvidenceSet> {
    const sql = selectCheckupNotes(
        input.evidence,
        input.task,
        MODEL_COHORT_LIMITS.perSource,
        undefined,
        false,
    )
    const semanticEvidence = readSemanticReferenceEvidence(input.evidence)
    const semantic = semanticEvidence
        ? semanticReferenceSamples(semanticEvidence, input.task).slice(
              0,
              MODEL_COHORT_LIMITS.perSource,
          )
        : []
    const candidates = [...semantic, ...sql].filter(
        (sample, index, all) =>
            all.findIndex((item) => item.note.noteId === sample.note.noteId) === index,
    )
    const identities = candidates.map(({ note }) => ({
        noteId: note.noteId,
        sources: [
            ...(sql.some((item) => item.note.noteId === note.noteId)
                ? ['sql' as CandidateSource]
                : []),
            ...(semantic.some((item) => item.note.noteId === note.noteId)
                ? ['semantic' as CandidateSource]
                : []),
        ],
    }))
    const evidence = { ...input.evidence, notes: candidates.map(({ note }) => note) }
    const scores = await scoreCheckupReferences({
        references: candidates.flatMap((sample) => mapCheckupReferences([sample])),
        evidence,
        predict: input.predict,
        expectedModelId: input.modelId,
        signal: input.signal,
        onUnavailable: input.onUnavailable,
        preservePrecision: true,
    })
    const scored = scores.flatMap((reference) =>
        reference.modelScore == null
            ? []
            : [
                  {
                      noteId: reference.noteId,
                      score: reference.modelScore,
                      sources: identities.find((item) => item.noteId === reference.noteId)!.sources,
                  },
              ],
    )
    const cohort = {
        policy: MODEL_COHORT_POLICY,
        modelId: input.modelId,
        parentEvidenceVersion: input.evidence.evidenceVersion,
        candidates: identities,
        scored,
        ...selectModelCohort(scored),
    }
    return {
        ...evidence,
        extensions: { ...evidence.extensions, [MODEL_COHORT_KEY]: cohort },
        evidenceVersion: createHash('sha256')
            .update(JSON.stringify({ source: evidence.evidenceVersion, cohort }))
            .digest('hex'),
    }
}
