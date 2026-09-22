import { PERFORMANCE, extractStructureFeatures } from '@teeho/content-metrics'
import { createHash } from 'node:crypto'
import type { PluginRuntime } from '../../customization/contract'
import { PluginError } from '../../customization/errors'
import { predictInsight } from '../../runtime/insight'
import type { logger } from '../../utils/logger'
import { AnalysisReferenceUnavailableError } from '../analysis.errors'
import {
    analysisInternalExecutionTraceSchema,
    type AgentAnalysisResult,
    type AnalysisInternalExecutionTrace,
} from '../analysis.schema'
import type { AnalysisEvidenceSource } from '../evidence/analysis.evidence'
import { understandTaskMaterials } from '../materials/analysis.material'
import { resolveAnalysisCover } from '../media/analysis.cover'
import {
    AgentContractError,
    AgentCancelledError,
    AgentProviderError,
    type AgentImageAsset,
    type AgentProvider,
    type AgentVideoEvidence,
} from '../providers/analysis.provider'
import type { ClaimedAnalysisTask } from '../tasks/analysis.queue.repository'
import { analysisTrackCatalog } from '../tracks/analysis.tracks'
import type {
    AgentUsageCallService,
    AgentUsageProviderDescriptor,
} from '../usage/analysis.agent-usage.service'
import { checkupOutputConstraints, checkupVersions } from './analysis.checkup.constants'
import { checkupReportSchema, roundCheckupScore } from './analysis.checkup.contract'
import { loadCheckupEvidence } from './analysis.checkup.evidence'
import type { AnalysisQuantificationEvidenceStore } from './analysis.checkup.evidence-store'
import { checkupReferences, selectCheckupNotes } from './analysis.checkup.selection'
import { scoreCheckupReferences } from './analysis.reference-scoring'
import {
    readSemanticReferenceEvidence,
    semanticReferenceSamples,
} from './analysis.reference-evidence'
import { mapCheckupReferences } from './analysis.checkup.selection'
import {
    checkupTopicEvidenceSchema,
    type CheckupTopicEvidence,
    type CheckupTopicEvidenceSource,
} from './analysis.checkup.topics'

import {
    readContentExplanation,
    fallbackContentExplanation,
} from './analysis.comparison-explanation'
import { collectRiskCandidates } from './analysis.risk-candidates'
import { contentScoreMultiplier } from './analysis.content-analysis'
import { calculateDifferences } from './analysis.differences'
import { calculateStructureReferences } from './analysis.structure-metrics'
const SHANGHAI_OFFSET_MS = 28800000
const RETRY_ATTEMPT = 2
const DATE_WIDTH = 10

export interface CheckupEvaluationInput {
    insightEnabled: boolean
    plugins: PluginRuntime
    materialDescriptions?: import('../materials/analysis.material').UnderstoodMaterials
    predict?: typeof predictInsight
    topicEvidenceSource?: CheckupTopicEvidenceSource
    task: ClaimedAnalysisTask
    requestId: string
    asOfDate: string
    asOf?: string
    signal: AbortSignal
    evidenceSource: AnalysisEvidenceSource
    referenceSource?: AnalysisEvidenceSource
    evidenceStore: AnalysisQuantificationEvidenceStore
    agent: {
        provider: AgentProvider
        descriptor: AgentUsageProviderDescriptor
        usage: AgentUsageCallService
    }
    media: {
        images: AgentImageAsset[]
        originalImages: AgentImageAsset[]
        videoEvidence: AgentVideoEvidence | null
        imageInputCount: number
        videoFrameInputCount: number
    }
    log: Pick<typeof logger, 'debug' | 'warn' | 'error'>
}

export interface CheckupEvaluation {
    result: AgentAnalysisResult
    trace: AnalysisInternalExecutionTrace
}

async function loadTopics(input: CheckupEvaluationInput): Promise<CheckupTopicEvidence> {
    const asOf = input.task.processingStartedAt
    if (!input.topicEvidenceSource) return { status: 'no_sources', asOf, topics: [] }
    const load = () =>
        input.topicEvidenceSource!.load({
            task: input.task.standardTask,
            asOf,
            signal: input.signal,
        })
    try {
        const evidence = checkupTopicEvidenceSchema.parse(
            await load().catch((error: unknown) => {
                if (input.signal.aborted || error instanceof PluginError) throw error
                return load()
            }),
        )
        if (input.signal.aborted) throw input.signal.reason
        return { ...evidence, asOf }
    } catch (error) {
        if (input.signal.aborted) throw input.signal.reason
        if (error instanceof PluginError) throw error
        input.log.warn(
            {
                event: 'analysis_topic_evidence_unavailable',
                taskId: input.task.id,
                errorCategory: error instanceof Error ? error.name : 'unknown',
            },
            '话题资料不可用，继续笔记评审',
        )
        return { status: 'failed', asOf, topics: [] }
    }
}

/** 编排素材理解、证据选择、独立算法与比较解释，结算由任务执行器负责。 */
export async function evaluateAnalysisCheckup(
    input: CheckupEvaluationInput,
): Promise<CheckupEvaluation> {
    const stored = await input.evidenceStore.find(input.task.id, input.task.userId)
    const localMaterials = stored?.materialDescriptions ?? (await understandTaskMaterials(input))
    const provisionalTask = classifiedTask(
        input.task.standardTask,
        localMaterials,
        input.media.originalImages,
        input.media.videoEvidence,
    )
    const context = {
        ...input,
        materialDescriptions: localMaterials,
        task: { ...input.task, standardTask: provisionalTask },
    }
    const evidence = await loadCheckupEvidence(context, stored)
    if (evidence.maintenanceStats) {
        const audit = {
            event: 'analysis_maintenance_stats',
            taskId: input.task.id,
            ...evidence.maintenanceStats,
        }
        if (evidence.maintenanceStats.status === 'failed')
            input.log.warn(audit, '维护统计不可用，使用原始子群统计')
        else input.log.debug(audit, '维护统计仅作覆盖及偏斜审计')
    }
    const materials = evidence.materialDescriptions ?? localMaterials
    const task = classifiedTask(
        input.task.standardTask,
        materials,
        input.media.originalImages,
        input.media.videoEvidence,
    )
    const samples = selectCheckupNotes(evidence, task)
    const semanticEvidence = readSemanticReferenceEvidence(evidence)
    const referenceEvidence = semanticEvidence ?? evidence
    const selectedReferences = semanticEvidence
        ? mapCheckupReferences(
              semanticReferenceSamples(semanticEvidence, task),
              'semantic_similarity',
          )
        : checkupReferences(samples)
    const publication =
        task.publishedAt ??
        new Date(Date.parse(input.task.processingStartedAt) + SHANGHAI_OFFSET_MS)
            .toISOString()
            .slice(0, DATE_WIDTH)
    const insight = input.insightEnabled
        ? await (input.predict ?? predictInsight)(
              {
                  title: task.fields.title.value,
                  body: task.fields.body.value,
                  topics: task.fields.topics.value,
                  cover: materials.cover,
                  contentType: task.contentKind,
                  publishedAt: publication,
              },
              publication,
              materials.primaryTrack,
              materials.secondaryTracks ?? [],
          )
        : null
    const references = await scoreCheckupReferences({
        references: selectedReferences,
        evidence: referenceEvidence,
        predict: input.insightEnabled ? (input.predict ?? predictInsight) : undefined,
        expectedModelId: insight?.modelId ?? null,
        signal: input.signal,
        onUnavailable: (category, durationMs) =>
            input.log.warn(
                {
                    event: 'analysis_reference_score_unavailable',
                    category,
                    durationMs,
                    modelId: insight?.modelId ?? null,
                    taskId: input.task.id,
                    requestId: input.requestId,
                },
                '参考评分不可用',
            ),
    })
    const topicEvidence = await loadTopics({
        ...context,
        task: { ...input.task, standardTask: task },
    })
    const differences = calculateDifferences(evidence, task, references)
    const generationBase = {
        task,
        materialDescriptions: materials,
        comparisonFacts: differences,
        comparisonNotes: references,
        topicEvidence,
        images: [],
        reviewFrameTimes: input.media.videoEvidence?.frames.map((frame) => frame.timestampMs),
        scoreContext: { score: insight?.baseScore ?? null, reference: insight?.reference ?? null },
        signal: input.signal,
        correlation: {
            requestId: input.requestId,
            taskId: input.task.id,
            attempt: input.task.attemptCount,
        },
    }
    const riskCandidates = collectRiskCandidates(generationBase)
    const reviewCandidates = riskCandidates.filter((candidate) => candidate.riskLevel !== 'high')
    const generationInput = { ...generationBase, riskCandidates: reviewCandidates }
    const candidateMatches = riskCandidates.map(
        ({ term, category, location, evidence, context, riskLevel }) => ({
            term,
            category,
            location,
            evidence,
            description: context,
            riskLevel,
        }),
    )
    const explain = (attempt: number) =>
        input.agent.usage.execute({
            userId: input.task.userId,
            association: { kind: 'task', id: input.task.id },
            requestId: input.requestId,
            stage: 'generate_result',
            provider: input.agent.descriptor,
            promptVersion: checkupVersions.explanation,
            attemptNumber: attempt,
            media: { imageInputCount: 0, videoFrameInputCount: 0 },
            invoke: async () => {
                try {
                    return await input.agent.provider.generateResult(generationInput)
                } catch (error) {
                    if (input.signal.aborted || error instanceof AgentProviderError) throw error
                    throw new AgentProviderError('capability', { cause: error })
                }
            },
            parse: (raw: unknown) => readContentExplanation(generationInput, raw),
            shouldRetry: (error) =>
                attempt === 1 && error instanceof AgentProviderError && error.retryable,
        })
    const tracked = await explain(1)
        .catch(async (error: unknown) => {
            if (input.signal.aborted || !(error instanceof AgentProviderError) || !error.retryable)
                throw error
            return explain(RETRY_ATTEMPT)
        })
        .catch((error: unknown) => {
            if (
                input.signal.aborted ||
                error instanceof AgentCancelledError ||
                !(error instanceof AgentProviderError)
            )
                throw error
            input.log.warn(
                {
                    event: 'analysis_content_review_fallback',
                    taskId: input.task.id,
                    errorCategory: error.category,
                },
                '内容分析失败，使用默认三星',
            )
            return { value: fallbackContentExplanation(generationInput), metadata: null }
        })
    const forceZero = tracked.value.status === 'completed' && tracked.value.consistency.stars === 0
    if (!references.length)
        throw new AnalysisReferenceUnavailableError({
            candidateCount: evidence.notes.length,
            selectedCount: samples.length,
            similarityPolicy: 'ranking',
            trackCode: evidence.selectionCriteria.trackCode,
            sourceVersion: evidence.sourceVersion,
            cutoff: evidence.selectedAt,
        })
    if (!forceZero) {
        if (
            insight &&
            (insight.status !== 'available' || insight.baseScore === null || insight.limited)
        )
            throw new AgentContractError('Model cannot reliably score this note', {
                ruleId: 'insight.coverage.required',
            })
    }
    const pluginOutput = await input.plugins.evaluate(evidence, task, input.signal, {
        topicEvidence,
        matchedTopicIds: tracked.value.matchedTopicIds,
    })
    const topicSupport = {
        scores: pluginOutput.radar,
        topics: pluginOutput.topicSupport.matchedTopics,
        bonus: pluginOutput.topicSupport.bonus,
    }
    const validScores = Object.values(topicSupport.scores).filter(
        (score): score is number => score !== null,
    )
    const MINIMUM_AVERAGE_DIMENSIONS = 4
    if (!insight && validScores.length < MINIMUM_AVERAGE_DIMENSIONS)
        throw new AgentContractError('Insufficient radar evidence', {
            ruleId: 'radar.coverage.required',
        })
    const originalScore = insight
        ? insight.status === 'available' && insight.baseScore !== null && !insight.limited
            ? roundCheckupScore(insight.baseScore)
            : null
        : roundCheckupScore(validScores.reduce((sum, score) => sum + score, 0) / validScores.length)
    const scorePolicy = 'consistency-weighted.v2' as const
    const mainScore = forceZero
        ? 0
        : roundCheckupScore(
              originalScore! * contentScoreMultiplier({ ...tracked.value, scorePolicy }),
          )
    const frozenReference = insight?.reference
    const reference =
        frozenReference &&
        frozenReference.sampleCount >= PERFORMANCE.minimumSamples &&
        frozenReference.trackCode === materials.primaryTrack
            ? {
                  ...frozenReference,
                  mean: roundCheckupScore(frozenReference.mean),
                  median: roundCheckupScore(frozenReference.median),
                  min: frozenReference.min == null ? null : roundCheckupScore(frozenReference.min),
                  max: frozenReference.max == null ? null : roundCheckupScore(frozenReference.max),
                  p10: roundCheckupScore(frozenReference.p10),
                  p90: roundCheckupScore(frozenReference.p90),
              }
            : null
    const result = checkupReportSchema.parse({
        schemaVersion: 'analysis-result.v7',
        riskReviewStatus:
            !reviewCandidates.length || tracked.value.dismissedRiskIds !== undefined
                ? 'completed'
                : 'unavailable',
        riskMatches: [
            ...new Map(
                candidateMatches
                    .filter(
                        (match, index) =>
                            match.riskLevel === 'high' ||
                            (tracked.value.dismissedRiskIds !== undefined &&
                                !tracked.value.dismissedRiskIds.includes(
                                    riskCandidates[index]!.id,
                                )),
                    )
                    .map((match) => [`${match.location}:${match.term}:${match.category}`, match]),
            ).values(),
        ],
        contentAnalysis: {
            scorePolicy,
            status: tracked.value.status,
            consistency: tracked.value.consistency,
            termRisks: tracked.value.termRisks,
            weaknesses: tracked.value.weaknesses,
            originalScore,
        },
        customMetrics: pluginOutput.customMetrics,
        structureMetrics: extractStructureFeatures(
            task.fields.title.value,
            task.fields.body.value,
            task.fields.topics.value,
        ),
        structureReferences: calculateStructureReferences(evidence, task),
        primaryScore: { source: insight ? 'insight' : 'radar_average', value: mainScore },
        primaryTrack: materials.primaryTrack,
        secondaryTracks: materials.secondaryTracks ?? [],
        radar: topicSupport.scores,
        differences,
        insight: insight
            ? {
                  status: 'available',
                  score: mainScore,
                  limited: false,
                  modelId: insight.modelId,
                  scoringMode: insight.scoringMode,
                  tracks: insight.tracks,
                  reference: reference,
                  comparison: reference
                      ? Math.abs(
                            Math.round(mainScore * checkupOutputConstraints.decimalScale) -
                                Math.round(
                                    reference.median * checkupOutputConstraints.decimalScale,
                                ),
                        ) <=
                        checkupOutputConstraints.referenceNearDifference *
                            checkupOutputConstraints.decimalScale
                          ? 'near'
                          : mainScore > reference.median
                            ? 'above'
                            : 'below'
                      : null,
              }
            : null,
        qualitativeConclusion: { summary: tracked.value.consistency.summary },
        comparisonNotes: references,
        topicSupport: {
            status: topicEvidence.status,
            matchedTopics: topicSupport.topics,
            bonus: topicSupport.bonus,
        },
    })
    const trace = analysisInternalExecutionTraceSchema.parse({
        schemaVersion: 'execution-trace.v4',
        metricEvidence: pluginOutput.metricEvidence,
        pluginVersion: input.plugins.version,
        insightModelId: insight?.modelId ?? null,
        insightCoverDescription: materials.cover,
        provider: input.agent.descriptor.provider,
        model: input.agent.descriptor.model,
        requestId: input.requestId,
        executionId: tracked.metadata?.executionId ?? null,
        algorithmVersion: checkupVersions.algorithm,
        evidenceSourceVersion: evidence.sourceVersion,
        evidenceVersion: evidence.evidenceVersion,
        matchedNoteCount: samples.length,
        checkupFeatureHash: createHash('sha256')
            .update(JSON.stringify({ materials, radar: topicSupport.scores }))
            .digest('hex'),
        generateResultPromptVersion: checkupVersions.explanation,
        taskStructureVersion: task.structureVersion,
        usage: tracked.metadata?.usage ?? null,
        topicEvidence,
    })
    return { result, trace }
}

function classifiedTask(
    task: import('../analysis.schema').StandardAnalysisTask,
    materials: import('../materials/analysis.material').UnderstoodMaterials,
    images: readonly AgentImageAsset[],
    videoEvidence: AgentVideoEvidence | null,
): import('../analysis.schema').StandardAnalysisTask {
    const track = analysisTrackCatalog.find((item) => item.code === materials.primaryTrack)!
    const cover = resolveAnalysisCover(task, images, videoEvidence)
    return {
        ...task,
        analysisIntent: materials.intent,
        secondaryTracks: materials.secondaryTracks ?? [],
        ...(cover ? { coverGeometry: { width: cover.width, height: cover.height } } : {}),
        materialSummary: [materials.cover, materials.content].filter(Boolean).join('\n'),
        fields: {
            ...task.fields,
            track: { value: track.id, source: 'agent_inference' },
            customTrackName: { value: track.custom ? 'Other' : null, source: 'agent_inference' },
        },
    }
}
