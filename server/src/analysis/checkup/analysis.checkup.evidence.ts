import { createHash } from 'node:crypto'
import { z } from 'zod'
import { PluginError } from '../../customization/errors'
import { analysisEvidenceSetSchema, type AnalysisEvidenceSet } from '../evidence/analysis.evidence'
import { resolveAnalysisTrackCode } from '../tracks/analysis.tracks'
import { checkupVersions } from './analysis.checkup.constants'
import type { CheckupEvaluationInput } from './analysis.checkup.evaluation'
import { SEMANTIC_REFERENCE_KEY, semanticReferenceSamples } from './analysis.reference-evidence'

const recallFailureSchema = z.object({
    category: z.enum(['embedding_failed', 'query_failed', 'timeout']),
    modelVersion: z.string().nullable(),
})
const recallIdentitySchema = z.object({ modelVersion: z.string() })

function unavailableEvidence(input: CheckupEvaluationInput, asOf: string): AnalysisEvidenceSet {
    return {
        schemaVersion: 'analysis-evidence.v3',
        sourceVersion: 'unavailable',
        evidenceVersion: createHash('sha256')
            .update(
                JSON.stringify({
                    asOf,
                    fingerprint: input.task.inputFingerprint,
                    unavailable: true,
                }),
            )
            .digest('hex'),
        selectedAt: asOf,
        selectionCriteria: {
            trackCode: resolveAnalysisTrackCode(input.task.standardTask.fields.track.value),
            searchTerms: [],
            dataAnchor: null,
            observationHistoryStatus: 'failed',
            selectionVersion: checkupVersions.selection,
            algorithmVersion: checkupVersions.algorithm,
        },
        matchedNoteCount: 0,
        aggregate: {
            totalNoteCount: 0,
            matchedNoteCount: 0,
            matchedAuthorCount: 0,
        },
        notes: [],
    }
}

/** 同一任务首写冻结素材与事实；失败证据交由执行器判定无案例并释放积分。 */
export async function loadCheckupEvidence(
    input: CheckupEvaluationInput,
    existing?: AnalysisEvidenceSet | null,
): Promise<AnalysisEvidenceSet> {
    const stored =
        existing === undefined
            ? await input.evidenceStore.find(input.task.id, input.task.userId)
            : existing
    if (input.signal.aborted) throw input.signal.reason
    if (stored) return stored
    let evidence: AnalysisEvidenceSet
    const asOf = input.asOf ?? `${input.asOfDate}T00:00:00.000Z`
    try {
        const load = () =>
            input.evidenceSource.load({
                task: input.task.standardTask,
                inputFingerprint: input.task.inputFingerprint,
                signal: input.signal,
                asOf,
            })
        evidence = analysisEvidenceSetSchema.parse(
            await load().catch((error: unknown) => {
                if (input.signal.aborted || error instanceof PluginError) throw error
                return load()
            }),
        )
    } catch (error) {
        if (input.signal.aborted) throw input.signal.reason ?? error
        if (error instanceof PluginError) throw error
        input.log.warn(
            {
                event: 'analysis_note_evidence_degraded',
                taskId: input.task.id,
                reason: 'load_failed',
            },
            '笔记参考数据暂不可用',
        )
        evidence = unavailableEvidence(input, asOf)
    }
    if (input.signal.aborted) throw input.signal.reason
    if (input.referenceSource) {
        const started = Date.now()
        try {
            const recalled = analysisEvidenceSetSchema.parse(
                await input.referenceSource.load({
                    task: input.task.standardTask,
                    inputFingerprint: input.task.inputFingerprint,
                    signal: input.signal,
                    asOf,
                }),
            )
            const atCutoff = { ...recalled, selectedAt: asOf }
            const referenceEvidence = {
                ...atCutoff,
                notes: semanticReferenceSamples(atCutoff, input.task.standardTask).map(
                    (sample) => sample.note,
                ),
            }
            evidence = {
                ...evidence,
                extensions: { ...evidence.extensions, [SEMANTIC_REFERENCE_KEY]: referenceEvidence },
            }
            const identity = recallIdentitySchema.safeParse(
                recalled.extensions?.['teeho/embedding-identity'],
            )
            input.log.debug(
                {
                    event: 'analysis_reference_recall',
                    source: referenceEvidence.notes.length ? 'semantic' : 'sql',
                    count: referenceEvidence.notes.length,
                    candidateCount: recalled.aggregate.totalNoteCount,
                    durationMs: Date.now() - started,
                    modelVersion: identity.success ? identity.data.modelVersion : null,
                    category: referenceEvidence.notes.length ? 'selected' : 'empty',
                    taskId: input.task.id,
                    requestId: input.requestId,
                },
                '参考召回完成',
            )
        } catch (error) {
            input.signal.throwIfAborted()
            const failure = recallFailureSchema.safeParse(error)
            input.log.warn(
                {
                    event: 'analysis_reference_recall',
                    source: 'sql',
                    category: failure.success ? failure.data.category : 'semantic_unavailable',
                    modelVersion: failure.success ? failure.data.modelVersion : null,
                    durationMs: Date.now() - started,
                    candidateCount: null,
                    taskId: input.task.id,
                    requestId: input.requestId,
                },
                '语义召回不可用，使用原查询',
            )
        }
    }
    input.signal.throwIfAborted()
    const withMaterials = input.materialDescriptions
        ? {
              ...evidence,
              materialDescriptions: input.materialDescriptions,
              evidenceVersion: createHash('sha256')
                  .update(
                      JSON.stringify({
                          source: evidence.evidenceVersion,
                          materials: input.materialDescriptions,
                      }),
                  )
                  .digest('hex'),
          }
        : evidence
    return input.evidenceStore.freeze(input.task.id, input.task.userId, withMaterials)
}
