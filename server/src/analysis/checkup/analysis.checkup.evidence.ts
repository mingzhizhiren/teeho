import { createHash } from 'node:crypto'
import { ModelServiceUnavailableError } from '../../utils/model-service-error'
import { z } from 'zod'
import { PluginError } from '../../customization/errors'
import { analysisEvidenceSetSchema, type AnalysisEvidenceSet } from '../evidence/analysis.evidence'
import { resolveAnalysisTrackCode } from '../tracks/analysis.tracks'
import { checkupVersions } from './analysis.checkup.constants'
import type { CheckupEvaluationInput } from './analysis.checkup.evaluation'
import { SEMANTIC_REFERENCE_KEY, semanticReferenceSamples } from './analysis.reference-evidence'

const recallTimingsSchema = z.object({
    embeddingDurationMs: z.number().finite().nonnegative().optional(),
    queryDurationMs: z.number().finite().nonnegative().optional(),
    validationDurationMs: z.number().finite().nonnegative().optional(),
    queryAttempts: z.number().int().nonnegative().optional(),
    retryErrorCode: z
        .string()
        .regex(/^[A-Z0-9_]{1,32}$/u)
        .optional(),
})
const recallFailureSchema = z.object({
    category: z.enum(['embedding_failed', 'query_failed', 'validation_failed', 'timeout']),
    modelVersion: z.string().nullable(),
    diagnostics: recallTimingsSchema
        .extend({
            stage: z.enum(['embedding', 'query', 'validation']),
            errorCode: z
                .string()
                .regex(/^[A-Z0-9_]{1,32}$/u)
                .optional(),
        })
        .optional(),
})
const recallIdentitySchema = recallTimingsSchema.extend({ modelVersion: z.string() })

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
    prepare?: (evidence: AnalysisEvidenceSet) => Promise<AnalysisEvidenceSet>,
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
        if (
            error instanceof PluginError &&
            (!input.referenceSource || error.category !== 'source_failed')
        )
            throw error
        input.log.warn(
            {
                event: 'analysis_note_evidence_degraded',
                taskId: input.task.id,
                reason: 'load_failed',
                ...(error instanceof PluginError
                    ? { capability: error.capability, errorCategory: error.category }
                    : {}),
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
                    source: 'semantic',
                    sourceKind: 'semantic',
                    state: referenceEvidence.notes.length ? 'selected' : 'empty',
                    ...(identity.success
                        ? {
                              embeddingDurationMs: identity.data.embeddingDurationMs,
                              queryDurationMs: identity.data.queryDurationMs,
                              validationDurationMs: identity.data.validationDurationMs,
                              queryAttempts: identity.data.queryAttempts,
                              retryErrorCode: identity.data.retryErrorCode,
                              retryDecision:
                                  (identity.data.queryAttempts ?? 0) > 1
                                      ? 'read_retry_succeeded'
                                      : undefined,
                          }
                        : {}),
                    count: referenceEvidence.notes.length,
                    candidateCount: recalled.aggregate.totalNoteCount,
                    durationMs: Date.now() - started,
                    modelVersion: identity.success ? identity.data.modelVersion : null,
                    category: referenceEvidence.notes.length ? 'selected' : 'empty',
                    taskId: input.task.id,
                    requestId: input.requestId,
                },
                '语义候选召回完成，交由两路合并选择',
            )
        } catch (error) {
            input.signal.throwIfAborted()
            if (error instanceof ModelServiceUnavailableError) throw error
            const failure = recallFailureSchema.safeParse(error)
            input.log.warn(
                {
                    event: 'analysis_reference_recall',
                    source: 'sql',
                    sourceKind: 'sql',
                    state: 'degraded',
                    errorCategory: failure.success ? failure.data.category : 'semantic_unavailable',
                    ...(failure.success ? failure.data.diagnostics : {}),
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
    // 数据库证据不可变：模型分和随机选择完成后才首写，不能先保存候选再 UPDATE。
    const prepared = prepare ? await prepare(withMaterials) : withMaterials
    input.signal.throwIfAborted()
    return input.evidenceStore.freeze(input.task.id, input.task.userId, prepared)
}
