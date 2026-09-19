import { z } from 'zod'
import { customMetricLimits, customMetricSchema } from '../../customization/report'
import { checkupOutputConstraints } from './analysis.checkup.constants'
import { checkupTopicConstraints, checkupTopicSupportSchema } from './analysis.checkup.topics'
import { differenceSchema } from './analysis.differences'
import { structureMetricsSchema, structureReferencesSchema } from './analysis.structure-metrics'
import { radarScoresSchema } from './analysis.radar'
import {
    contentAnalysisSchema,
    contentRiskSchema,
    contentScoreMultiplier,
} from './analysis.content-analysis'
export { checkupOutputConstraints } from './analysis.checkup.constants'

const MAXIMUM_INSIGHT_TRACKS = 4
const insightReferenceGroupSchema = z
    .object({
        trackCode: z.number().int().min(0).max(checkupOutputConstraints.maximumTrackCode),
        sampleCount: z.number().int().nonnegative(),
        mean: z.number().min(0).max(checkupOutputConstraints.insightMaximumScore),
        median: z.number().min(0).max(checkupOutputConstraints.insightMaximumScore),
        min: z
            .number()
            .min(0)
            .max(checkupOutputConstraints.insightMaximumScore)
            .nullable()
            .optional(),
        max: z
            .number()
            .min(0)
            .max(checkupOutputConstraints.insightMaximumScore)
            .nullable()
            .optional(),
        p10: z.number().min(0).max(checkupOutputConstraints.insightMaximumScore),
        p90: z.number().min(0).max(checkupOutputConstraints.insightMaximumScore),
    })
    .strict()

/** 发布前体检固定的六维顺序。 */
export const checkupMetricNames = [
    'topicDemand',
    'titleCoverExpression',
    'contentFulfillment',
    'readingExperience',
    'interactionValue',
    'differentiationTiming',
] as const
export type CheckupMetric = (typeof checkupMetricNames)[number]

/** 所有体检来源分使用百分制，业务结果规范化到两位小数。 */
export const checkupScoreSchema = z
    .number()
    .finite()
    .min(checkupOutputConstraints.minimumScore)
    .max(checkupOutputConstraints.maximumScore)
const metricSchema = z
    .object({
        score: checkupScoreSchema,
        reason: z.string().trim().min(1).max(checkupOutputConstraints.itemMaxLength),
    })
    .strict()
const metricEntries = Object.fromEntries(
    checkupMetricNames.map((name) => [name, metricSchema]),
) as Record<CheckupMetric, typeof metricSchema>
const scoreEntries = Object.fromEntries(
    checkupMetricNames.map((name) => [name, checkupScoreSchema]),
) as Record<CheckupMetric, typeof checkupScoreSchema>

export const checkupScoresSchema = z.object(scoreEntries).strict()
export type CheckupScores = z.infer<typeof checkupScoresSchema>
export const checkupEvaluationsSchema = z.object(metricEntries).strict()

/** 风险位置只引用用户笔记，不提供改写内容。 */
export const checkupRiskSchema = z
    .object({
        severity: z.enum(['priority', 'notice']),
        message: z.string().trim().min(1).max(checkupOutputConstraints.itemMaxLength),
        suggestion: z.string().trim().max(checkupOutputConstraints.itemMaxLength),
        location: z
            .object({
                kind: z.enum(['title', 'body', 'topics', 'cover', 'image', 'video']),
                quote: z.string().max(checkupOutputConstraints.itemMaxLength).optional(),
                imageIndex: z.number().int().nonnegative().optional(),
                timestampMs: z.number().int().nonnegative().optional(),
            })
            .strict(),
    })
    .strict()

/** 最终Agent只交付独立评审，禁止内容方案字段。 */
export const checkupAgentResultSchema = z
    .object({
        agentMetricEvaluations: checkupEvaluationsSchema,
        coverDescription: z
            .string()
            .max(checkupOutputConstraints.summaryMaxLength)
            .nullable()
            .optional(),
        matchedTopicIds: z
            .array(z.string().trim().min(1).max(checkupTopicConstraints.idMaxLength))
            .max(checkupTopicConstraints.matchLimit)
            .default([]),
        summary: z.string().trim().min(1).max(checkupOutputConstraints.summaryMaxLength),
        strengths: z
            .array(z.string().trim().min(1).max(checkupOutputConstraints.itemMaxLength))
            .max(checkupOutputConstraints.maxStrengths),
        risks: z.array(checkupRiskSchema).max(checkupOutputConstraints.maxRisks),
        uncertainties: z
            .array(z.string().trim().min(1).max(checkupOutputConstraints.itemMaxLength))
            .max(checkupOutputConstraints.maxUncertainties),
    })
    .strict()
export type CheckupAgentResult = z.infer<typeof checkupAgentResultSchema>

export const checkupReferenceSchema = z
    .object({
        noteId: z.string(),
        title: z.string(),
        bodyExcerpt: z.string().max(checkupOutputConstraints.excerptMaxLength),
        likes: z.number().nonnegative(),
        collects: z.number().nonnegative(),
        comments: z.number().nonnegative().nullable(),
        url: z
            .string()
            .url()
            .refine((value) => value.startsWith('https://'))
            .nullable(),
        reason: z.string(),
    })
    .strict()
export type CheckupReference = z.infer<typeof checkupReferenceSchema>

export const checkupReportSchema = z
    .object({
        schemaVersion: z.enum(['analysis-result.v6', 'analysis-result.v7']),
        contentAnalysis: contentAnalysisSchema.optional(),
        riskMatches: z.array(contentRiskSchema).optional(),
        riskReviewStatus: z.enum(['completed', 'unavailable']).optional(),
        customMetrics: z.array(customMetricSchema).max(customMetricLimits.count).optional(),
        structureMetrics: structureMetricsSchema,
        structureReferences: structureReferencesSchema,
        primaryScore: z
            .object({
                source: z.enum(['insight', 'radar_average']),
                value: z.number().finite().min(0).max(checkupOutputConstraints.insightMaximumScore),
            })
            .strict()
            .optional(),
        primaryTrack: z.number().int().min(0).max(checkupOutputConstraints.maximumTrackCode),
        secondaryTracks: z
            .array(z.number().int().min(1).max(checkupOutputConstraints.maximumTrackCode))
            .max(MAXIMUM_INSIGHT_TRACKS - 1)
            .optional(),
        insight: z
            .object({
                status: z.literal('available'),
                score: z.number().finite().min(0).max(checkupOutputConstraints.insightMaximumScore),
                limited: z.literal(false),
                modelId: z.string().nullable().optional(),
                scoringMode: z.enum(['legacy_shared', 'track_conditioned']).optional(),
                tracks: z
                    .array(
                        z
                            .object({
                                trackCode: z
                                    .number()
                                    .int()
                                    .min(0)
                                    .max(checkupOutputConstraints.maximumTrackCode),
                                weight: z.number().finite().positive().max(1),
                                score: z
                                    .number()
                                    .finite()
                                    .min(0)
                                    .max(checkupOutputConstraints.insightMaximumScore),
                            })
                            .strict(),
                    )
                    .min(1)
                    .max(MAXIMUM_INSIGHT_TRACKS)
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
                            .max(MAXIMUM_INSIGHT_TRACKS)
                            .optional(),
                    })
                    .strict()
                    .nullable(),
                comparison: z.enum(['near', 'above', 'below']).nullable(),
            })
            .strict()
            .nullable(),
        radar: radarScoresSchema,
        differences: z.array(differenceSchema).max(checkupOutputConstraints.maxReferences),
        qualitativeConclusion: z
            .object({
                summary: z.string().trim().min(1).max(checkupOutputConstraints.summaryMaxLength),
            })
            .strict(),
        comparisonNotes: z
            .array(checkupReferenceSchema)
            .max(checkupOutputConstraints.maxReferences),
        topicSupport: z
            .object({
                status: z.enum(['collected', 'no_sources', 'failed']),
                matchedTopics: checkupTopicSupportSchema.shape.matchedTopics,
                bonus: z.number().min(0).max(1),
            })
            .strict(),
    })
    .strict()
    .superRefine((report, context) => {
        const primary = report.primaryScore
        const forceZero =
            report.contentAnalysis?.status === 'completed' &&
            report.contentAnalysis.consistency.stars === 0
        const invalid = () =>
            context.addIssue({
                code: 'custom',
                message: 'Invalid primary score source',
                path: ['primaryScore'],
            })
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
        if (forceZero && primary.value !== 0) invalid()
        if (!forceZero && !report.comparisonNotes.length) invalid()
        if (primary.source === 'insight') {
            if (!report.insight || primary.value !== report.insight.score) invalid()
            if (
                report.contentAnalysis &&
                !forceZero &&
                roundCheckupScore(
                    report.contentAnalysis.originalScore! *
                        contentScoreMultiplier(report.contentAnalysis),
                ) !== primary.value
            )
                invalid()
        } else {
            const scores = Object.values(report.radar).filter(
                (score): score is number => score !== null,
            )
            const minimum = 4
            const decimals = 100
            const average =
                Math.round(
                    scores.reduce((sum, value) => sum + Math.round(value * decimals), 0) /
                        scores.length,
                ) / decimals
            if (
                report.insight !== null ||
                scores.length < minimum ||
                primary.value !==
                    (forceZero
                        ? 0
                        : roundCheckupScore(
                              average *
                                  (report.contentAnalysis
                                      ? contentScoreMultiplier(report.contentAnalysis)
                                      : 1),
                          )) ||
                (report.contentAnalysis && report.contentAnalysis.originalScore !== average)
            )
                invalid()
        }
    })
export type CheckupReport = z.infer<typeof checkupReportSchema>

/** 对非负百分制分数四舍五入至两位。 */
export function roundCheckupScore(value: number): number {
    if (!Number.isFinite(value)) throw new Error('评分必须是有限数值')
    const bounded = Math.min(
        checkupOutputConstraints.maximumScore,
        Math.max(checkupOutputConstraints.minimumScore, value),
    )
    const shifted = Number(
        `${bounded.toFixed(checkupOutputConstraints.roundingPrecision)}e${checkupOutputConstraints.decimalPlaces}`,
    )
    return Math.round(shifted) / checkupOutputConstraints.decimalScale
}
