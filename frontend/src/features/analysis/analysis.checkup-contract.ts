import { z } from 'zod'
import { customMetricSchema, customMetricLimits } from './analysis.custom-metrics'
import {
    noteScoringAuditSchema,
    noteScoringCoefficientSchema,
    validSavedNoteScoring,
} from './analysis.note-scoring'
import {
    structureMetricsSchema,
    structureReferencesSchema,
    structureLocationsSchema,
    currentStructureMetricsSchema,
    currentStructureReferencesSchema,
} from './analysis.structure-metrics'
import { hasFullReportAccess, reportAccessSchema } from './analysis.report-access'
import { validateProjectedReportAccess } from './analysis.report-projection'
const INSIGHT_MAX_SCORE = 10
import { analysisUiConstraints } from './analysis.constants'
import {
    contentAnalysisSchema,
    expectedContentScore,
    riskMatchSchema,
    projectedContentAnalysisSchema,
} from './analysis.content-analysis'

/** 浏览器独立维护的六维体检评分顺序。 */
const REFERENCE_LIMITS = { tracks: 30, score: 10, selectedTracks: 4 } as const
const insightReferenceGroupSchema = z
    .object({
        contentType: z.enum(['image', 'video']).optional(),
        trackCode: z.number().int().min(0).max(REFERENCE_LIMITS.tracks),
        sampleCount: z.number().int().nonnegative(),
        mean: z.number().min(0).max(REFERENCE_LIMITS.score),
        median: z.number().min(0).max(REFERENCE_LIMITS.score),
        min: z.number().min(0).max(REFERENCE_LIMITS.score).nullable().optional(),
        max: z.number().min(0).max(REFERENCE_LIMITS.score).nullable().optional(),
        p10: z.number().min(0).max(REFERENCE_LIMITS.score),
        p90: z.number().min(0).max(REFERENCE_LIMITS.score),
    })
    .strict()

const radarValue = z.number().finite().min(0).max(REFERENCE_LIMITS.score).nullable()
export const radarMetricNames = [
    'topicDemand',
    'titleExpression',
    'contentDevelopment',
    'readingExperience',
    'interactionPotential',
    'distinctiveness',
] as const
export const radarScoresSchema = z
    .object({
        topicDemand: radarValue,
        titleExpression: radarValue,
        contentDevelopment: radarValue,
        readingExperience: radarValue,
        interactionPotential: radarValue,
        distinctiveness: radarValue,
    })
    .strict()
export type RadarScores = z.infer<typeof radarScoresSchema>
export const noteDifferenceSchema = z
    .object({
        id: z.string(),
        metric: z.enum(radarMetricNames),
        feature: z.enum([
            'titleLength',
            'bodyLength',
            'paragraphs',
            'paragraphLength',
            'lexicalVariety',
        ]),
        value: z.number().finite(),
        low: z.number().finite(),
        high: z.number().finite(),
        severity: z.enum(['aligned', 'minor', 'moderate', 'major', 'critical']),
        referenceIds: z.array(z.string()),
    })
    .strict()
const httpsUrlSchema = z
    .string()
    .url()
    .refine((value) => new URL(value).protocol === 'https:')
const TOPIC_SUPPORT_LIMITS = { count: 5, bonus: 5, idLength: 128, titleLength: 200 } as const
const topicCountSchema = z.number().int().nonnegative().safe()
const topicSupportSchema = z
    .object({
        status: z.enum(['collected', 'no_sources', 'failed']),
        matchedTopics: z
            .array(
                z
                    .object({
                        topicId: z.string().trim().min(1).max(TOPIC_SUPPORT_LIMITS.idLength),
                        trackCodes: z
                            .array(z.number().int().min(0).max(REFERENCE_LIMITS.tracks))
                            .optional(),
                        title: z.string().trim().min(1).max(TOPIC_SUPPORT_LIMITS.titleLength),
                        observedAt: z.string().datetime(),
                        joinCount: topicCountSchema,
                        viewCount: topicCountSchema,
                        previousObservedAt: z.string().datetime().nullable(),
                        joinDelta: z.number().int().safe().nullable(),
                        viewDelta: z.number().int().safe().nullable(),
                    })
                    .strict(),
            )
            .max(TOPIC_SUPPORT_LIMITS.count),
        bonuses: z
            .object({
                topicDemand: z.number().min(0).max(TOPIC_SUPPORT_LIMITS.bonus),
                differentiationTiming: z.number().min(0).max(TOPIC_SUPPORT_LIMITS.bonus),
            })
            .strict(),
    })
    .strict()

/** 完整体检报告。拒绝混入已退役的内容生成方案。 */
const analysisResultShapeSchema = z
    .object({
        schemaVersion: z.enum(['analysis-result.v6', 'analysis-result.v7']),
        noteScoringCoefficient: noteScoringCoefficientSchema.optional(),
        noteScoringAudit: noteScoringAuditSchema.optional(),
        customMetrics: z.array(customMetricSchema).max(customMetricLimits.count).optional(),
        structureMetrics: structureMetricsSchema,
        structureReferences: structureReferencesSchema,
        structureMetricsVersion: z.enum(['structure.v2', 'structure.v3']).optional(),
        structureReferencePolicy: z.string().min(1).optional(),
        structureLocations: structureLocationsSchema.optional(),
        primaryScore: z
            .object({
                source: z.enum(['insight', 'radar_average']),
                value: z.number().finite().min(0).max(INSIGHT_MAX_SCORE),
            })
            .strict()
            .optional(),
        primaryTrack: z.number().int().min(0).max(REFERENCE_LIMITS.tracks),
        secondaryTracks: z
            .array(z.number().int().min(1).max(REFERENCE_LIMITS.tracks))
            .max(REFERENCE_LIMITS.selectedTracks - 1)
            .optional(),
        radar: radarScoresSchema,
        differences: z.array(noteDifferenceSchema).default([]),
        insight: z
            .object({
                status: z.literal('available'),
                score: z.number().finite().min(0).max(INSIGHT_MAX_SCORE),
                limited: z.literal(false),
                modelId: z.string().nullable().optional(),
                scoringMode: z.enum(['legacy_shared', 'track_conditioned']).optional(),
                tracks: z
                    .array(
                        z
                            .object({
                                trackCode: z.number().int().min(0).max(REFERENCE_LIMITS.tracks),
                                weight: z.number().finite().positive().max(1),
                                score: z.number().finite().min(0).max(REFERENCE_LIMITS.score),
                            })
                            .strict(),
                    )
                    .min(1)
                    .max(REFERENCE_LIMITS.selectedTracks)
                    .optional(),
                reference: insightReferenceGroupSchema
                    .extend({
                        aggregation: z.enum(['single_track', 'weighted_tracks']).optional(),
                        components: z
                            .array(
                                insightReferenceGroupSchema
                                    .extend({
                                        weight: z.number().finite().positive().max(1),
                                    })
                                    .strict(),
                            )
                            .min(1)
                            .max(REFERENCE_LIMITS.selectedTracks)
                            .optional(),
                    })
                    .strict()
                    .nullable()
                    .optional(),
                comparison: z.enum(['near', 'above', 'below']).nullable().optional(),
            })
            .strict()
            .nullable(),
        qualitativeConclusion: z.object({ summary: z.string().trim().min(1) }).strict(),
        contentAnalysis: contentAnalysisSchema.optional(),
        riskMatches: z.array(riskMatchSchema).optional(),
        riskReviewStatus: z.enum(['completed', 'unavailable']).optional(),
        topicSupport: z
            .object({
                status: z.enum(['collected', 'no_sources', 'failed']),
                matchedTopics: topicSupportSchema.shape.matchedTopics,
                bonus: z.number().min(0).max(1),
            })
            .strict(),
        referenceRequirement: z.enum(['required', 'optional']).optional(),
        comparisonNotes: z
            .array(
                z
                    .object({
                        noteId: z.string(),
                        title: z.string(),
                        bodyExcerpt: z.string(),
                        topics: z.array(z.string()).optional(),
                        likes: z.number().finite().nonnegative(),
                        collects: z.number().finite().nonnegative(),
                        comments: z.number().finite().nonnegative().nullable(),
                        url: httpsUrlSchema.nullable(),
                        reason: z.string(),
                        modelScore: z
                            .number()
                            .finite()
                            .min(0)
                            .max(INSIGHT_MAX_SCORE)
                            .nullable()
                            .optional(),
                        modelId: z.string().nullable().optional(),
                    })
                    .strict(),
            )
            .max(analysisUiConstraints.referenceSourcesMaximum),
    })
    .strict()

/** 未裁剪的历史与完整报告继续校验原始评分、系数和引用关系。 */
export const fullAnalysisResultSchema = analysisResultShapeSchema.superRefine((report, context) => {
    if (
        !validSavedNoteScoring(report) ||
        (report.noteScoringCoefficient !== undefined &&
            report.schemaVersion !== 'analysis-result.v7')
    )
        context.addIssue({
            code: 'custom',
            path: ['noteScoringCoefficient'],
            message: 'Invalid saved note scoring coefficient',
        })
    if (
        report.structureMetricsVersion === 'structure.v3' &&
        (report.structureMetrics.imageCount === undefined ||
            report.structureReferences.imageCount === undefined ||
            report.structureMetrics.videoDurationSeconds === undefined ||
            report.structureReferences.videoDurationSeconds === undefined)
    )
        context.addIssue({
            code: 'custom',
            path: ['structureMetrics'],
            message: 'Incomplete structure v3 report',
        })
    if (
        report.structureMetricsVersion !== undefined &&
        (report.structureMetrics.maxTopicLength === undefined ||
            report.structureMetrics.maxParagraphLength == null ||
            report.structureReferences.maxTopicLength === undefined ||
            report.structureReferences.maxParagraphLength === undefined ||
            !report.structureLocations)
    )
        context.addIssue({
            code: 'custom',
            path: ['structureMetrics'],
            message: 'Incomplete structure v2 report',
        })
    const primary = report.primaryScore
    const isBlocked =
        report.contentAnalysis?.status === 'completed' &&
        report.contentAnalysis.consistency.stars === 0
    if (
        (!isBlocked || report.contentAnalysis?.scorePolicy === 'consistency-weighted.v2') &&
        report.referenceRequirement !== 'optional' &&
        report.comparisonNotes.length === 0
    ) {
        context.addIssue({
            code: 'custom',
            path: ['comparisonNotes'],
            message: 'Missing reference notes',
        })
    }
    const invalid = () =>
        context.addIssue({
            code: 'custom',
            message: 'Invalid primary score source',
            path: ['primaryScore'],
        })
    if (
        isBlocked &&
        ((primary && primary.value !== 0) || (report.insight && report.insight.score !== 0))
    ) {
        invalid()
    }
    if (report.contentAnalysis) {
        const savedScore = primary?.value ?? report.insight?.score
        if (
            savedScore !==
            expectedContentScore(report.contentAnalysis, report.noteScoringCoefficient)
        )
            invalid()
        const referenceIds = new Set(report.comparisonNotes.map((note) => note.noteId))
        if (
            report.contentAnalysis.weaknesses.some((item) =>
                item.referenceIds.some((id) => !referenceIds.has(id)),
            )
        ) {
            context.addIssue({
                code: 'custom',
                path: ['contentAnalysis', 'weaknesses'],
                message: 'Unknown reference note',
            })
        }
    }
    if (report.schemaVersion === 'analysis-result.v6') {
        if (
            !report.insight ||
            primary?.source === 'radar_average' ||
            (primary && primary.value !== report.insight.score)
        )
            invalid()
        return
    }
    if (!primary) {
        invalid()
        return
    }
    if (primary.source === 'insight') {
        if (!report.insight || primary.value !== report.insight.score) invalid()
    } else {
        const scores = Object.values(report.radar).filter(
            (score): score is number => score !== null,
        )
        const minimum = 4
        const decimals = 100
        const average =
            report.noteScoringCoefficient === undefined
                ? Math.round(
                      scores.reduce((sum, value) => sum + Math.round(value * decimals), 0) /
                          scores.length,
                  ) / decimals
                : scores.reduce((sum, value) => sum + value, 0) / scores.length
        if (
            report.insight !== null ||
            scores.length < minimum ||
            primary.value !==
                (report.contentAnalysis
                    ? expectedContentScore(report.contentAnalysis, report.noteScoringCoefficient)
                    : average)
        )
            invalid()
        if (report.contentAnalysis && report.contentAnalysis.originalScore !== average) invalid()
    }
})

const fullResultWithAccessSchema = fullAnalysisResultSchema
    .safeExtend({
        reportAccess: reportAccessSchema.optional(),
    })
    .superRefine((report, context) => {
        if (report.reportAccess && !hasFullReportAccess(report.reportAccess)) {
            context.addIssue({
                code: 'custom',
                path: ['reportAccess'],
                message: 'Restricted report requires projection',
            })
        }
        if (
            report.reportAccess &&
            report.comparisonNotes.length > report.reportAccess.sections.comparisonNotes.limit
        ) {
            context.addIssue({
                code: 'custom',
                path: ['comparisonNotes'],
                message: 'Too many visible reference notes',
            })
        }
    })

/** 展示 DTO 独立校验权限裁剪；不使用缺失的内部数据重新计算最终分。 */
export const projectedAnalysisResultSchema = analysisResultShapeSchema
    .extend({
        reportAccess: reportAccessSchema,
        structureMetrics: currentStructureMetricsSchema.partial(),
        structureReferences: currentStructureReferencesSchema.partial(),
        structureLocations: structureLocationsSchema.partial().optional(),
        contentAnalysis: projectedContentAnalysisSchema.optional(),
        noteScoringCoefficient: z.never().optional(),
        noteScoringAudit: z.never().optional(),
        customMetrics: z.never().optional(),
        radar: z.never().optional(),
        differences: z.never().optional(),
        qualitativeConclusion: z.never().optional(),
        topicSupport: z.never().optional(),
        riskMatches: z.array(riskMatchSchema).optional(),
    })
    .superRefine(validateProjectedReportAccess)

/** 接口与本地历史接受完整报告或带明确权限快照的裁剪报告。 */
export const analysisResultSchema = z.union([
    fullResultWithAccessSchema,
    projectedAnalysisResultSchema,
])
