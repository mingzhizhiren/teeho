import { createHash } from 'node:crypto'
import { PluginError } from '../../customization/errors'
import { analysisEvidenceSetSchema, type AnalysisEvidenceSet } from '../evidence/analysis.evidence'
import { resolveAnalysisTrackCode } from '../tracks/analysis.tracks'
import { checkupVersions } from './analysis.checkup.constants'
import type { CheckupEvaluationInput } from './analysis.checkup.evaluation'

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
