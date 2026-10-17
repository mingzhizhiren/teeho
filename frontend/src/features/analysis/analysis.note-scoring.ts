import { z } from 'zod'
import {
    structureMetricNames,
    type StructureMetrics,
    type StructureReferences,
} from './analysis.structure-metrics'

const LIMITS = { base: 0.55, allowance: 0.5, neutral: 1, maximum: 1.05, tolerance: 1e-10 } as const
const SEVERITY_CONTRIBUTIONS = {
    aligned: 1,
    minor: 0.75,
    moderate: 0.5,
    major: 0.25,
    critical: 0,
} as const
const metricSchema = z.enum(structureMetricNames)
const auditShape = z
    .object({
        policy: z.literal('structure-coefficient.v1'),
        contentKind: z.enum(['image', 'video']),
        reviewCompleted: z.boolean(),
        evaluated: z
            .array(
                z
                    .object({
                        metric: metricSchema,
                        severity: z.enum(['aligned', 'minor', 'moderate', 'major', 'critical']),
                        contribution: z.number().finite().min(0).max(LIMITS.allowance),
                    })
                    .strict(),
            )
            .max(structureMetricNames.length),
        unavailable: z.array(metricSchema).max(structureMetricNames.length),
        notApplicable: z.array(metricSchema).length(1),
    })
    .strict()

/** 只校验报告冻结的结构系数明细，不用当前笔记或模型重算历史。 */
export const noteScoringAuditSchema = auditShape.superRefine((audit, context) => {
    const all = [
        ...audit.evaluated.map((item) => item.metric),
        ...audit.unavailable,
        ...audit.notApplicable,
    ]
    const excluded = audit.contentKind === 'image' ? 'videoDurationSeconds' : 'imageCount'
    const allowance = LIMITS.allowance / audit.evaluated.length
    if (
        all.length !== structureMetricNames.length ||
        new Set(all).size !== structureMetricNames.length ||
        audit.notApplicable[0] !== excluded ||
        audit.evaluated.some(
            (item) =>
                Math.abs(item.contribution - allowance * SEVERITY_CONTRIBUTIONS[item.severity]) >
                LIMITS.tolerance,
        )
    )
        context.addIssue({ code: 'custom', message: 'Invalid note scoring audit' })
})
export type NoteScoringAudit = z.infer<typeof noteScoringAuditSchema>
export const noteScoringCoefficientSchema = z.number().finite().min(LIMITS.base).max(LIMITS.maximum)

function coefficientFromAudit(audit: NoteScoringAudit): number {
    if (!audit.evaluated.length) return LIMITS.neutral
    const maximum =
        audit.unavailable.length || !audit.reviewCompleted ? LIMITS.neutral : LIMITS.maximum
    return Math.min(
        maximum,
        LIMITS.base + audit.evaluated.reduce((sum, item) => sum + item.contribution, 0),
    )
}

/** 新系数须与保存的证据一致；旧报告缺省时保持原有评分口径。 */
export function validSavedNoteScoring(report: {
    noteScoringCoefficient?: number
    noteScoringAudit?: NoteScoringAudit
    contentAnalysis?: {
        status: 'completed' | 'fallback'
        scorePolicy?: 'consistency-weighted.v1' | 'consistency-weighted.v2'
    }
    structureMetrics: StructureMetrics
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
        Math.abs(report.noteScoringCoefficient - coefficientFromAudit(audit)) <= LIMITS.tolerance &&
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
