import { z } from 'zod'

export const CONTENT_ANALYSIS_LIMITS = {
    stars: 5,
    fallbackStars: 3,
    findings: 5,
    risks: 20,
    evidence: 500,
    description: 800,
    references: 4,
    referenceId: 120,
    maximumScore: 10,
} as const
export const contentLocationSchema = z.enum(['title', 'body', 'topics', 'cover', 'content'])
export const contentFindingSchema = z
    .object({
        location: contentLocationSchema,
        evidence: z.string().trim().min(1).max(CONTENT_ANALYSIS_LIMITS.evidence),
        description: z.string().trim().min(1).max(CONTENT_ANALYSIS_LIMITS.description),
    })
    .strict()
export const contentConsistencySchema = z
    .object({
        stars: z.number().int().min(0).max(CONTENT_ANALYSIS_LIMITS.stars),
        summary: z.string().trim().min(1).max(CONTENT_ANALYSIS_LIMITS.description),
        issues: z.array(contentFindingSchema).max(CONTENT_ANALYSIS_LIMITS.findings),
    })
    .strict()
export const contentWeaknessSchema = contentFindingSchema
    .extend({
        suggestion: z.string().trim().min(1).max(CONTENT_ANALYSIS_LIMITS.description).optional(),
        referenceIds: z
            .array(z.string().min(1).max(CONTENT_ANALYSIS_LIMITS.referenceId))
            .min(1)
            .max(CONTENT_ANALYSIS_LIMITS.references),
    })
    .strict()
export const contentRiskSchema = contentFindingSchema
    .extend({
        term: z.string().min(1).max(CONTENT_ANALYSIS_LIMITS.evidence),
        category: z.string().min(1).max(CONTENT_ANALYSIS_LIMITS.evidence),
        riskLevel: z.enum(['high', 'medium', 'low']).optional(),
    })
    .strict()
export const contentAnalysisSchema = z
    .object({
        scorePolicy: z.enum(['consistency-weighted.v1', 'consistency-weighted.v2']).optional(),
        status: z.enum(['completed', 'fallback']),
        consistency: contentConsistencySchema,
        termRisks: z.array(contentRiskSchema).max(CONTENT_ANALYSIS_LIMITS.risks),
        weaknesses: z.array(contentWeaknessSchema).max(CONTENT_ANALYSIS_LIMITS.findings),
        originalScore: z
            .number()
            .finite()
            .min(0)
            .max(CONTENT_ANALYSIS_LIMITS.maximumScore)
            .nullable(),
    })
    .strict()
    .superRefine((value, context) => {
        if (
            value.originalScore === null &&
            !(value.status === 'completed' && value.consistency.stars === 0)
        ) {
            context.addIssue({
                code: 'custom',
                message: 'Missing original score is only allowed for zero-star gating',
            })
        }
        if (
            value.status === 'fallback' &&
            (value.consistency.stars !== CONTENT_ANALYSIS_LIMITS.fallbackStars ||
                value.consistency.issues.length ||
                value.termRisks.length ||
                value.weaknesses.length)
        ) {
            context.addIssue({ code: 'custom', message: 'Invalid fallback analysis' })
        }
        if (value.consistency.stars === 0 && !value.consistency.issues.length) {
            context.addIssue({ code: 'custom', message: 'Zero stars require located evidence' })
        }
    })
export type ContentAnalysis = z.infer<typeof contentAnalysisSchema>
export type ContentLocation = z.infer<typeof contentLocationSchema>

const ONE_STAR_MULTIPLIER = 0.25
const TWO_STAR_MULTIPLIER = 0.5
const CONSISTENCY_MULTIPLIERS = [0, ONE_STAR_MULTIPLIER, TWO_STAR_MULTIPLIER, 1, 1, 1] as const
const V122_ONE_STAR_MULTIPLIER = 0.3
const V122_TWO_STAR_MULTIPLIER = 0.6
const V122_MULTIPLIERS = [0, V122_ONE_STAR_MULTIPLIER, V122_TWO_STAR_MULTIPLIER, 1, 1, 1] as const
/** 按报告保存的规则计算折算比例，旧报告维持仅零星归零的口径。 */
export function contentScoreMultiplier(
    analysis: Pick<ContentAnalysis, 'status' | 'consistency' | 'scorePolicy'>,
): number {
    if (analysis.status !== 'completed') return 1
    if (analysis.consistency.stars === 0) return 0
    if (analysis.scorePolicy === 'consistency-weighted.v2')
        return V122_MULTIPLIERS[analysis.consistency.stars] ?? 1
    return analysis.scorePolicy === 'consistency-weighted.v1'
        ? (CONSISTENCY_MULTIPLIERS[analysis.consistency.stars] ?? 1)
        : 1
}
