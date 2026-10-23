import { z } from 'zod'
import { MEDIA_STRUCTURE_KEYS } from '@teeho/content-metrics'
import type { StructureReferences } from './analysis.structure-metrics'

/** 结构系数独立于内容星级倍率；旧报告缺少此策略时不补算。 */
export const NOTE_SCORING_POLICY = 'structure-coefficient.v2'
export const NOTE_SCORING_LIMITS = {
    base: 0.5,
    legacyBase: 0.55,
    allowance: 0.5,
    neutral: 1,
    maximum: 1.05,
    fiveStarBonus: 0.05,
    maximumStars: 5,
    tolerance: 1e-10,
} as const
const SEVERITY_CONTRIBUTIONS = {
    aligned: 1,
    minor: 0.75,
    moderate: 0.5,
    major: 0.25,
    critical: 0,
} as const
const metricSchema = z.enum(MEDIA_STRUCTURE_KEYS)
const severitySchema = z.enum(['aligned', 'minor', 'moderate', 'major', 'critical'])
const auditShape = z
    .object({
        policy: z.enum(['structure-coefficient.v1', NOTE_SCORING_POLICY]),
        contentKind: z.enum(['image', 'video']),
        reviewCompleted: z.boolean(),
        evaluated: z
            .array(
                z
                    .object({
                        metric: metricSchema,
                        severity: severitySchema,
                        contribution: z.number().finite().min(0).max(NOTE_SCORING_LIMITS.allowance),
                    })
                    .strict(),
            )
            .max(MEDIA_STRUCTURE_KEYS.length),
        unavailable: z.array(metricSchema).max(MEDIA_STRUCTURE_KEYS.length),
        notApplicable: z.array(metricSchema).length(1),
    })
    .strict()
type NoteScoringAuditShape = z.infer<typeof auditShape>
type StructureMetric = (typeof MEDIA_STRUCTURE_KEYS)[number]
type StructureValues = Readonly<Partial<Record<StructureMetric, number | null>>>

/** 从已冻结的逐指标贡献读取系数，不重新计算历史参考范围。 */
export function coefficientFromAudit(audit: NoteScoringAuditShape, stars: number): number {
    const contribution = audit.evaluated.reduce((sum, item) => sum + item.contribution, 0)
    if (audit.policy === NOTE_SCORING_POLICY) {
        const structure = audit.evaluated.length
            ? Math.min(NOTE_SCORING_LIMITS.neutral, NOTE_SCORING_LIMITS.base + contribution)
            : NOTE_SCORING_LIMITS.neutral
        const bonus =
            audit.reviewCompleted && stars === NOTE_SCORING_LIMITS.maximumStars
                ? NOTE_SCORING_LIMITS.fiveStarBonus
                : 0
        return structure + bonus
    }
    if (!audit.evaluated.length) return NOTE_SCORING_LIMITS.neutral
    const maximum =
        audit.unavailable.length || !audit.reviewCompleted
            ? NOTE_SCORING_LIMITS.neutral
            : NOTE_SCORING_LIMITS.maximum
    return Math.min(maximum, NOTE_SCORING_LIMITS.legacyBase + contribution)
}

/** 校验保存的适用性和贡献明细，避免主分与解释使用不同口径。 */
export const noteScoringAuditSchema = auditShape.superRefine((audit, context) => {
    const all = [
        ...audit.evaluated.map((item) => item.metric),
        ...audit.unavailable,
        ...audit.notApplicable,
    ]
    const excluded = audit.contentKind === 'image' ? 'videoDurationSeconds' : 'imageCount'
    const allowance = NOTE_SCORING_LIMITS.allowance / audit.evaluated.length
    if (
        all.length !== MEDIA_STRUCTURE_KEYS.length ||
        new Set(all).size !== MEDIA_STRUCTURE_KEYS.length ||
        audit.notApplicable[0] !== excluded ||
        audit.evaluated.some(
            (item) =>
                Math.abs(item.contribution - allowance * SEVERITY_CONTRIBUTIONS[item.severity]) >
                NOTE_SCORING_LIMITS.tolerance,
        )
    )
        context.addIssue({ code: 'custom', message: 'Invalid note scoring audit' })
})
export type NoteScoringAudit = z.infer<typeof noteScoringAuditSchema>
export const noteScoringCoefficientSchema = z
    .number()
    .finite()
    .min(NOTE_SCORING_LIMITS.base)
    .max(NOTE_SCORING_LIMITS.maximum)

/** 分摊有效指标额度；仅已完成的五星内容评审额外增加系数。 */
export function calculateNoteScoring(
    contentKind: 'image' | 'video',
    metrics: StructureValues,
    references: StructureReferences,
    reviewCompleted: boolean,
    stars: number,
): { noteScoringCoefficient: number; noteScoringAudit: NoteScoringAudit } {
    const excluded = contentKind === 'image' ? 'videoDurationSeconds' : 'imageCount'
    const applicable = MEDIA_STRUCTURE_KEYS.filter((metric) => metric !== excluded)
    const available = applicable.filter(
        (metric) => metrics[metric] != null && references[metric] != null,
    )
    const allowance = NOTE_SCORING_LIMITS.allowance / available.length
    const noteScoringAudit = noteScoringAuditSchema.parse({
        policy: NOTE_SCORING_POLICY,
        contentKind,
        reviewCompleted,
        evaluated: available.map((metric) => ({
            metric,
            severity: references[metric]!.severity,
            contribution: allowance * SEVERITY_CONTRIBUTIONS[references[metric]!.severity],
        })),
        unavailable: applicable.filter((metric) => !available.includes(metric)),
        notApplicable: [excluded],
    })
    return {
        noteScoringCoefficient: coefficientFromAudit(noteScoringAudit, stars),
        noteScoringAudit,
    }
}

/** 新报告必须同时保留系数、审计和内容评审；缺省字段仅表示旧报告。 */
export function validSavedNoteScoring(report: {
    noteScoringCoefficient?: number
    noteScoringAudit?: NoteScoringAudit
    contentAnalysis?: {
        status: 'completed' | 'fallback'
        consistency: { stars: number }
        scorePolicy?: 'consistency-weighted.v1' | 'consistency-weighted.v2'
    }
    structureMetrics: StructureValues
    structureReferences: StructureReferences
}): boolean {
    if (report.noteScoringCoefficient === undefined && report.noteScoringAudit === undefined)
        return true
    const audit = report.noteScoringAudit
    if (
        !audit ||
        report.noteScoringCoefficient === undefined ||
        report.contentAnalysis?.scorePolicy !== 'consistency-weighted.v2'
    )
        return false
    return (
        audit.reviewCompleted === (report.contentAnalysis.status === 'completed') &&
        Math.abs(
            report.noteScoringCoefficient -
                coefficientFromAudit(audit, report.contentAnalysis.consistency.stars),
        ) <= NOTE_SCORING_LIMITS.tolerance &&
        audit.evaluated.every(
            (item) =>
                report.structureMetrics[item.metric] != null &&
                report.structureReferences[item.metric]?.severity === item.severity,
        ) &&
        audit.unavailable.every(
            (metric) =>
                report.structureMetrics[metric] == null ||
                report.structureReferences[metric] == null,
        )
    )
}
