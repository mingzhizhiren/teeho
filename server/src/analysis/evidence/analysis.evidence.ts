import { createHash } from 'node:crypto'

import { z } from 'zod'
import { understoodMaterialsSchema } from '../materials/analysis.material.contract'
import { maintenanceStatsSchema } from './analysis.daily-stats'

import type { ReadonlyData } from '../../customization/immutable'
import { analysisEvidenceConstraints, analysisInputConstraints } from '../analysis.constants'
import type { StandardAnalysisTask } from '../analysis.schema'
import {
    checkupSampling,
    checkupVersions,
    checkupOutputConstraints,
} from '../checkup/analysis.checkup.constants'
import { secondaryTrackCodesSchema } from '../tracks/analysis.track-selection'
import { analysisTrackIdSchema, resolveAnalysisTrackCode } from '../tracks/analysis.tracks'
import type { AnalysisEvidenceComment } from './analysis.evidence-repository.contract'

const nullableInteraction = z.number().int().nonnegative().nullable()
const mockNoteCount = 10
const mockInitialLikes = 100
const mockLikesStep = 20
const mockLikesGrowth = 10
const mockCollectRatio = 0.4
const mockCommentRatio = 0.1
const mockYear = 2026
const mockPublishedMonthIndex = 6
const mockObservedMonthIndex = 7
const mockFirstObservedDay = 1
const mockLatestObservedDay = 2

const analysisEvidenceObservationSchema = z
    .object({
        observedAt: z.string().datetime({ offset: true }),
        observationId: z.string().optional(),
        likes: nullableInteraction,
        collects: nullableInteraction,
        comments: nullableInteraction,
        shares: nullableInteraction.optional(),
    })
    .strict()

const analysisEvidenceCommentSchema: z.ZodType<AnalysisEvidenceComment> = z
    .object({
        content: z.string().min(1).max(analysisEvidenceConstraints.commentMaxCharacters),
        likes: nullableInteraction,
    })
    .strict()

const analysisEvidenceAggregateSchema = z
    .object({
        totalNoteCount: z.number().int().nonnegative(),
        matchedNoteCount: z.number().int().nonnegative(),
        matchedAuthorCount: z.number().int().nonnegative(),
    })
    .strict()

/** 固定证据集中的一篇真实笔记。 */
export const analysisEvidenceNoteSchema = z
    .object({
        noteId: z.string().min(1).max(analysisEvidenceConstraints.noteIdMaxLength),
        trackCodes: z.array(z.number().int().nonnegative()).optional(),
        modelTrackCodes: z
            .array(z.number().int().min(0).max(checkupOutputConstraints.maximumTrackCode))
            .optional(),
        modelTrackCode: z
            .number()
            .int()
            .min(0)
            .max(checkupOutputConstraints.maximumTrackCode)
            .nullable()
            .optional(),
        noteUrl: z.string().nullable().optional(),
        authorId: z.string().max(analysisEvidenceConstraints.noteIdMaxLength),
        noteType: z.enum(['normal', 'video']).optional(),
        fans: z.number().int().nonnegative().nullable().optional(),
        authorObservedAt: z.string().datetime({ offset: true }).nullable().optional(),
        contentObservedAt: z.string().datetime({ offset: true }).nullable().optional(),
        firstImportedAt: z.string().datetime({ offset: true }).nullable().optional(),
        coverDescription: z.string().nullable().optional(),
        coverSha: z.string().nullable().optional(),
        coverObservedAt: z.string().datetime({ offset: true }).nullable().optional(),
        coverWidth: z.number().int().positive().nullable().optional(),
        coverHeight: z.number().int().positive().nullable().optional(),
        title: z.string().max(analysisInputConstraints.fields.titleMaxLength),
        body: z.string().max(checkupSampling.evidenceBodyMaxLength),
        topics: z
            .array(z.string().max(analysisInputConstraints.fields.existingTopicMaxLength))
            .max(analysisInputConstraints.fields.topicsMaxItems),
        publishedAt: z.string().datetime({ offset: true }),
        createdAt: z.string().datetime({ offset: true }),
        observedAt: z.string().datetime({ offset: true }),
        topicMatched: z.boolean(),
        selectionScore: z.number().min(0).max(1),
        observations: z.array(analysisEvidenceObservationSchema).min(1),
        topComments: z
            .array(analysisEvidenceCommentSchema)
            .max(analysisEvidenceConstraints.maxCommentsPerNote)
            .default([]),
    })
    .strict()

/** 一次分析冻结的真实或模拟证据集合。 */
export const analysisEvidenceSetSchema = z
    .object({
        schemaVersion: z.literal('analysis-evidence.v3'),
        materialDescriptions: understoodMaterialsSchema.optional(),
        maintenanceStats: maintenanceStatsSchema.optional(),
        extensions: z
            .record(z.string().regex(/^[a-z][a-zA-Z0-9._-]*\/[a-zA-Z0-9._-]+$/u), z.unknown())
            .optional(),
        sourceVersion: z
            .string()
            .trim()
            .min(1)
            .max(analysisEvidenceConstraints.sourceVersionMaxLength),
        evidenceVersion: z
            .string()
            .length(analysisEvidenceConstraints.evidenceVersionLength)
            .regex(/^[0-9a-f]+$/u),
        selectedAt: z.string().datetime({ offset: true }),
        selectionCriteria: z
            .object({
                trackCode: z.number().int().nonnegative(),
                secondaryTracks: secondaryTrackCodesSchema.optional(),
                searchTerms: z.array(z.string()),
                dataAnchor: z.string().datetime({ offset: true }).nullable(),
                observationHistoryStatus: z.enum(['available', 'failed']).default('available'),
                selectionVersion: z.string().min(1),
                algorithmVersion: z.string().min(1),
            })
            .strict(),
        matchedNoteCount: z.number().int().nonnegative(),
        aggregate: analysisEvidenceAggregateSchema,
        notes: z.array(analysisEvidenceNoteSchema).max(analysisEvidenceConstraints.candidateLimit),
    })
    .strict()

export type AnalysisEvidenceSet = z.infer<typeof analysisEvidenceSetSchema>

export interface AnalysisEvidenceSourceInput {
    readonly task: ReadonlyData<StandardAnalysisTask>
    readonly inputFingerprint: string
    readonly signal: AbortSignal
    readonly asOf?: string
}

/** 分析算法的数据来源边界。 */
export interface AnalysisEvidenceSource {
    load(input: AnalysisEvidenceSourceInput): Promise<AnalysisEvidenceSet>
}

/** 从标准任务提取受限中文相关性检索词。 */
export function createSearchTerms(task: ReadonlyData<StandardAnalysisTask>): string[] {
    const values = [
        task.fields.title.value ?? '',
        task.fields.body.value ?? '',
        ...task.fields.topics.value,
        task.materialSummary ?? '',
    ]
    const terms = values.flatMap((value) => [
        value.trim(),
        ...value.split(/[\p{P}\p{S}\s]+/gu).map((term) => term.trim()),
    ])
    return [...new Set(terms)]
        .filter(Boolean)
        .map((term) => term.slice(0, analysisEvidenceConstraints.searchTermMaxLength))
        .slice(0, analysisEvidenceConstraints.searchTermLimit)
}

/** 真实赛道到爬虫稳定枚举的映射。 */
export function resolveTrackCode(task: ReadonlyData<StandardAnalysisTask>) {
    return resolveAnalysisTrackCode(analysisTrackIdSchema.parse(task.fields.track.value))
}

/** 用于测试和本地演示的确定性证据源。 */
export class MockAnalysisEvidenceSource implements AnalysisEvidenceSource {
    async load(input: AnalysisEvidenceSourceInput): Promise<AnalysisEvidenceSet> {
        if (input.signal.aborted) {
            throw input.signal.reason
        }
        const topic = input.task.fields.title.value ?? ''
        const includeText = Boolean(topic.trim() || input.task.fields.body.value?.trim())
        const notes = Array.from({ length: mockNoteCount }, (_, index) => {
            const latest = mockInitialLikes + index * mockLikesStep
            return {
                noteId: `mock-note-${index + 1}`,
                modelTrackCode: resolveTrackCode(input.task),
                noteType:
                    input.task.contentKind === 'video' ? ('video' as const) : ('normal' as const),
                authorId: `mock-author-${(index % mockNoteCount) + 1}`,
                title: includeText
                    ? `${topic.slice(0, analysisEvidenceConstraints.mockTitleTopicMaxLength)}参考笔记${index + 1}`
                    : '',
                body: includeText
                    ? `围绕${topic.slice(0, analysisEvidenceConstraints.mockBodyTopicMaxLength)}记录真实场景、使用感受和可执行要点。`
                    : '',
                topics: includeText
                    ? [
                          `#${topic.replace(/[\p{P}\p{S}\s]+/gu, '').slice(0, analysisEvidenceConstraints.mockTagTopicMaxLength) || '内容灵感'}`,
                      ]
                    : [],
                publishedAt: new Date(
                    Date.UTC(mockYear, mockPublishedMonthIndex, index + 1),
                ).toISOString(),
                createdAt: new Date(
                    Date.UTC(mockYear, mockPublishedMonthIndex, index + 1),
                ).toISOString(),
                observedAt: new Date(
                    Date.UTC(mockYear, mockObservedMonthIndex, mockLatestObservedDay),
                ).toISOString(),
                topicMatched: includeText,
                selectionScore: (index + 1) / mockNoteCount,
                observations: [
                    {
                        observedAt: new Date(
                            Date.UTC(mockYear, mockObservedMonthIndex, mockFirstObservedDay),
                        ).toISOString(),
                        likes: latest - mockLikesGrowth,
                        collects: Math.round((latest - mockLikesGrowth) * mockCollectRatio),
                        comments: Math.round((latest - mockLikesGrowth) * mockCommentRatio),
                    },
                    {
                        observedAt: new Date(
                            Date.UTC(mockYear, mockObservedMonthIndex, mockLatestObservedDay),
                        ).toISOString(),
                        likes: latest,
                        collects: Math.round(latest * mockCollectRatio),
                        comments: Math.round(latest * mockCommentRatio),
                    },
                ],
                topComments: [],
            }
        })
        const selectionCriteria = {
            trackCode: resolveTrackCode(input.task),
            searchTerms: createSearchTerms(input.task),
            dataAnchor: new Date(
                Date.UTC(mockYear, mockObservedMonthIndex, mockLatestObservedDay),
            ).toISOString(),
            observationHistoryStatus: 'available' as const,
            selectionVersion: checkupVersions.selection,
            algorithmVersion: checkupVersions.algorithm,
        }
        const matching = notes.filter((note) => note.topicMatched)
        const aggregate = {
            totalNoteCount: notes.length,
            matchedNoteCount: matching.length,
            matchedAuthorCount: new Set(matching.map((note) => note.authorId)).size,
        }
        return analysisEvidenceSetSchema.parse({
            schemaVersion: 'analysis-evidence.v3',
            sourceVersion: 'mock-evidence.v3',
            selectionCriteria,
            evidenceVersion: createHash('sha256')
                .update(JSON.stringify({ selectionCriteria, aggregate, notes }))
                .digest('hex'),
            selectedAt: '2026-08-02T00:00:00.000Z',
            matchedNoteCount: matching.length,
            aggregate,
            notes,
        })
    }
}
