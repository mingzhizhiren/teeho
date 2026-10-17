import { z } from 'zod'
import {
    contentAdviceSchema,
    contentAdviceCopyLines,
    type ContentAdviceLabels,
} from './analysis.advice'
import {
    canShowContentIndicator,
    canShowReportSection,
    type ReportAccess,
} from './analysis.report-access'

const CONTENT_ANALYSIS_LIMITS = {
    stars: 5,
    fallbackStars: 3,
    score: 10,
    text: 500,
    description: 800,
    issues: 5,
    risks: 20,
    weaknesses: 5,
    references: 4,
    referenceId: 120,
} as const

const findingText = z.string().trim().min(1).max(CONTENT_ANALYSIS_LIMITS.text)
const descriptionText = z.string().trim().min(1).max(CONTENT_ANALYSIS_LIMITS.description)
const locationSchema = z.enum(['title', 'body', 'topics', 'cover', 'content'])
const findingSchema = z
    .object({
        location: locationSchema,
        evidence: findingText,
        description: descriptionText,
    })
    .strict()

export const riskMatchSchema = findingSchema
    .extend({
        term: findingText,
        category: findingText,
        riskLevel: z.enum(['high', 'medium', 'low']).optional(),
    })
    .strict()

/** 已保存的内容一致性、词句风险和参考不足分析。 */
export const contentAnalysisShapeSchema = z
    .object({
        status: z.enum(['completed', 'fallback']),
        evaluationVersion: z.literal('content-evaluation.v2').optional(),
        advice: contentAdviceSchema.catch({ status: 'unavailable', items: [] }).optional(),
        scorePolicy: z.enum(['consistency-weighted.v1', 'consistency-weighted.v2']).optional(),
        consistency: z
            .object({
                stars: z.number().int().min(0).max(CONTENT_ANALYSIS_LIMITS.stars),
                summary: descriptionText,
                issues: z.array(findingSchema).max(CONTENT_ANALYSIS_LIMITS.issues),
            })
            .strict(),
        termRisks: z
            .array(
                findingSchema
                    .extend({
                        term: findingText,
                        category: findingText,
                    })
                    .strict(),
            )
            .max(CONTENT_ANALYSIS_LIMITS.risks),
        weaknesses: z
            .array(
                findingSchema
                    .extend({
                        suggestion: descriptionText.optional(),
                        referenceIds: z
                            .array(
                                z.string().trim().min(1).max(CONTENT_ANALYSIS_LIMITS.referenceId),
                            )
                            .min(1)
                            .max(CONTENT_ANALYSIS_LIMITS.references),
                    })
                    .strict(),
            )
            .max(CONTENT_ANALYSIS_LIMITS.weaknesses),
        originalScore: z.number().finite().min(0).max(CONTENT_ANALYSIS_LIMITS.score).nullable(),
    })
    .strict()

export const contentAnalysisSchema = contentAnalysisShapeSchema.superRefine((analysis, context) => {
    if (
        analysis.originalScore === null &&
        !(analysis.status === 'completed' && analysis.consistency.stars === 0)
    ) {
        context.addIssue({
            code: 'custom',
            path: ['originalScore'],
            message: 'Missing original score requires zero consistency',
        })
    }
    if (
        analysis.status === 'fallback' &&
        analysis.consistency.stars !== CONTENT_ANALYSIS_LIMITS.fallbackStars
    ) {
        context.addIssue({
            code: 'custom',
            path: ['consistency', 'stars'],
            message: 'Invalid fallback stars',
        })
    }
    if (
        analysis.status === 'fallback' &&
        (analysis.consistency.issues.length ||
            analysis.termRisks.length ||
            analysis.weaknesses.length)
    ) {
        context.addIssue({
            code: 'custom',
            message: 'Fallback must not claim analysis findings',
        })
    }
    if (
        analysis.status === 'completed' &&
        analysis.consistency.stars === 0 &&
        !analysis.consistency.issues.length
    ) {
        context.addIssue({
            code: 'custom',
            path: ['consistency', 'issues'],
            message: 'Missing inconsistency evidence',
        })
    }
})

/** 已经由服务端裁剪的内容分析，不把隐藏项补成空结果。 */
export const projectedContentAnalysisSchema = contentAnalysisShapeSchema.partial({
    consistency: true,
    termRisks: true,
    weaknesses: true,
    originalScore: true,
})

export type ProjectedContentAnalysis = z.infer<typeof projectedContentAnalysisSchema>

export type ContentAnalysis = z.infer<typeof contentAnalysisSchema>
export type ContentFinding = ContentAnalysis['consistency']['issues'][number]

/** 新策略只对已完成的一星、二星报告保留部分原始分。 */
export function contentScoreRetention(analysis: ContentAnalysis | undefined): number | null {
    if (analysis?.status !== 'completed' || !analysis.scorePolicy) return null
    const percentages: Readonly<Record<number, number>> =
        analysis.scorePolicy === 'consistency-weighted.v2' ? { 1: 30, 2: 60 } : { 1: 25, 2: 50 }
    return percentages[analysis.consistency.stars] ?? null
}

/** 校验保存的最终分；不重新评分或改变历史报告。 */
export function expectedContentScore(
    analysis: ContentAnalysis,
    noteScoringCoefficient?: number,
): number | null {
    if (analysis.status === 'completed' && analysis.consistency.stars === 0) return 0
    const percent = contentScoreRetention(analysis)
    if (analysis.originalScore === null) return null
    if (percent === null && noteScoringCoefficient === undefined) return analysis.originalScore
    const percentageScale = 100
    const roundingPrecision = 12
    const precision = 100
    const value = Math.min(
        CONTENT_ANALYSIS_LIMITS.score,
        (analysis.originalScore * (noteScoringCoefficient ?? 1) * (percent ?? percentageScale)) /
            percentageScale,
    )
    return Math.round(Number(`${value.toFixed(roundingPrecision)}e2`)) / precision
}

/** 复制报告复用界面语言与分析分段。 */
export interface ContentAnalysisLabels {
    title: string
    consistency: string
    risks: string
    weaknesses: string
    noRisks: string
    riskResultsMissing: string
    riskReviewUnavailable?: string
    noWeaknesses: string
    noObviousWeaknesses: string
    advice: ContentAdviceLabels
    fallback: string
    scoreBlocked: string
    references: string
    stars: (count: number) => string
    locations: Readonly<Record<ContentFinding['location'], string>>
}

/** 复制定位信息时保留证据原文。 */
export function formatContentFinding(
    finding: ContentFinding,
    labels: ContentAnalysisLabels,
): string {
    return `${labels.locations[finding.location]}: ${finding.evidence}\n${finding.description}`
}

/** 与网页顺序一致地复制已保存分析，不重新评估。 */
export function contentAnalysisCopyLines(
    analysis: ContentAnalysis | ProjectedContentAnalysis | undefined,
    legacySummary: string,
    notes: ReadonlyArray<{ noteId: string; title: string }>,
    labels: ContentAnalysisLabels,
    access?: ReportAccess,
): string[] {
    if (!canShowReportSection(access, 'contentAnalysis')) return []
    if (!analysis)
        return legacySummary && canShowContentIndicator(access, 'consistency')
            ? [labels.title, legacySummary]
            : [labels.title]
    const savedConsistency = canShowContentIndicator(access, 'consistency')
        ? analysis.consistency
        : undefined
    const consistency = savedConsistency
        ? [
              `${labels.title} · ${labels.consistency}: ${labels.stars(savedConsistency.stars)}`,
              labels.consistency,
              ...(analysis.status === 'fallback' ? [labels.fallback] : []),
              savedConsistency.summary,
              ...savedConsistency.issues.map((item) => formatContentFinding(item, labels)),
          ]
        : [labels.title]
    if (analysis.status === 'fallback') return consistency
    return [
        ...consistency,
        ...(canShowContentIndicator(access, 'advice')
            ? contentAdviceCopyLines(analysis.advice, labels.advice)
            : []),
        ...(canShowContentIndicator(access, 'weaknesses')
            ? [
                  labels.weaknesses,
                  ...(analysis.weaknesses?.length
                      ? analysis.weaknesses.map((item) =>
                            [
                                formatContentFinding(item, labels),
                                ...(item.suggestion && canShowContentIndicator(access, 'advice')
                                    ? [item.suggestion]
                                    : []),
                                `${labels.references} ${notes
                                    .filter((note) => item.referenceIds.includes(note.noteId))
                                    .map((note) => note.title)
                                    .join(' / ')}`,
                            ].join('\n'),
                        )
                      : [
                            analysis.evaluationVersion === 'content-evaluation.v2'
                                ? labels.noObviousWeaknesses
                                : labels.noWeaknesses,
                        ]),
              ]
            : []),
    ]
}
