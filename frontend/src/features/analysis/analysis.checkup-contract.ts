import { z } from 'zod'
import { customMetricSchema, customMetricLimits } from './analysis.custom-metrics'
import { structureMetricsSchema, structureReferencesSchema } from './analysis.structure-metrics'
const INSIGHT_MAX_SCORE = 10
import { analysisUiConstraints } from './analysis.constants'
import {
    contentAnalysisSchema,
    expectedContentScore,
    riskMatchSchema,
} from './analysis.content-analysis'

/** 浏览器独立维护的六维体检评分顺序。 */
const REFERENCE_LIMITS = { tracks: 30, score: 10, selectedTracks: 4 } as const
const insightReferenceGroupSchema = z
    .object({
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
export const analysisResultSchema = z
    .object({
        schemaVersion: z.enum(['analysis-result.v6', 'analysis-result.v7']),
        customMetrics: z.array(customMetricSchema).max(customMetricLimits.count).optional(),
        structureMetrics: structureMetricsSchema,
        structureReferences: structureReferencesSchema,
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
        comparisonNotes: z
            .array(
                z
                    .object({
                        noteId: z.string(),
                        title: z.string(),
                        bodyExcerpt: z.string(),
                        likes: z.number().finite().nonnegative(),
                        collects: z.number().finite().nonnegative(),
                        comments: z.number().finite().nonnegative().nullable(),
                        url: httpsUrlSchema.nullable(),
                        reason: z.string(),
                    })
                    .strict(),
            )
            .max(analysisUiConstraints.referenceSourcesMaximum),
    })
    .strict()
    .superRefine((report, context) => {
        const primary = report.primaryScore
        const isBlocked =
            report.contentAnalysis?.status === 'completed' &&
            report.contentAnalysis.consistency.stars === 0
        if (!isBlocked && report.comparisonNotes.length === 0) {
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
            if (savedScore !== expectedContentScore(report.contentAnalysis)) invalid()
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
                Math.round(
                    scores.reduce((sum, value) => sum + Math.round(value * decimals), 0) /
                        scores.length,
                ) / decimals
            if (
                report.insight !== null ||
                scores.length < minimum ||
                primary.value !==
                    (report.contentAnalysis
                        ? expectedContentScore(report.contentAnalysis)
                        : average)
            )
                invalid()
            if (report.contentAnalysis && report.contentAnalysis.originalScore !== average)
                invalid()
        }
    })
