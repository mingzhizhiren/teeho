import { z } from 'zod'
import { checkupReportSchema } from '../checkup/analysis.checkup.contract'
import { contentAnalysisSchema } from '../checkup/analysis.content-analysis'
import {
    structureLocationsSchema,
    structureMetricsSchema,
    structureReferencesSchema,
} from '../checkup/analysis.structure-metrics'
import {
    isFullReportAccess,
    reportAccessPolicySchema,
    type ReportAccessPolicy,
} from './analysis.report-access.policy'
import {
    CONTENT_ANALYSIS_INDICATORS,
    STRUCTURE_METRIC_INDICATORS,
    type ContentAnalysisIndicator,
    type StructureMetricIndicator,
} from './analysis.report-access.registry'

/** 这些历史辅助字段可能重复携带受限指标或建议，受限交付只使用显式报告字段。 */
export const RESTRICTED_REPORT_OMISSIONS = [
    'noteScoringCoefficient',
    'noteScoringAudit',
    'radar',
    'differences',
    'qualitativeConclusion',
    'topicSupport',
    'customMetrics',
] as const

const publicContentSchema = contentAnalysisSchema.innerType().partial({
    consistency: true,
    advice: true,
    weaknesses: true,
    termRisks: true,
    originalScore: true,
})

const projectedReportShape = checkupReportSchema
    .innerType()
    .partial({
        radar: true,
        differences: true,
        qualitativeConclusion: true,
        topicSupport: true,
    })
    .extend({
        reportAccess: reportAccessPolicySchema,
        contentAnalysis: publicContentSchema.optional(),
        structureMetrics: structureMetricsSchema.options[0].partial(),
        structureReferences: structureReferencesSchema.options[0].partial(),
        structureLocations: structureLocationsSchema.partial().optional(),
    })
    .strict()

type ProjectedReportShape = z.infer<typeof projectedReportShape>

function contentIssues(report: ProjectedReportShape, policy: ReportAccessPolicy): string[][] {
    const section = policy.sections.contentAnalysis
    const content = report.contentAnalysis
    if (!section.enabled)
        return [
            ...(content === undefined ? [] : [['contentAnalysis']]),
            ...(report.riskReviewStatus === undefined ? [] : [['riskReviewStatus']]),
            ...(report.riskMatches === undefined ? [] : [['riskMatches']]),
        ]
    const keys = Object.keys(CONTENT_ANALYSIS_INDICATORS) as ContentAnalysisIndicator[]
    const hidden = keys
        .filter((key) => !section.indicators[key] && content?.[key] !== undefined)
        .map((key) => ['contentAnalysis', key])
    return [
        ...hidden,
        ...(['originalScore', 'scorePolicy'] as const)
            .filter((key) => !section.indicators.consistency && content?.[key] !== undefined)
            .map((key) => ['contentAnalysis', key]),
        ...(!section.indicators.termRisks && report.riskReviewStatus !== undefined
            ? [['riskReviewStatus']]
            : []),
        ...(!section.indicators.termRisks && report.riskMatches !== undefined
            ? [['riskMatches']]
            : []),
        ...(!section.indicators.advice && content?.weaknesses?.some((item) => item.suggestion)
            ? [['contentAnalysis', 'weaknesses']]
            : []),
    ]
}

function structureIssues(report: ProjectedReportShape, policy: ReportAccessPolicy): string[][] {
    const section = policy.sections.structureMetrics
    const keys = Object.keys(STRUCTURE_METRIC_INDICATORS) as StructureMetricIndicator[]
    const issues = keys.flatMap((key) => {
        if (section.enabled && section.indicators[key]) return []
        return (['structureMetrics', 'structureReferences'] as const)
            .filter((field) => report[field][key] !== undefined)
            .map((field) => [field, key])
    })
    return [
        ...issues,
        ...((!section.enabled || !section.indicators.maxTopicLength) &&
        report.structureLocations?.topics
            ? [['structureLocations', 'topics']]
            : []),
        ...((!section.enabled || !section.indicators.maxParagraphLength) &&
        report.structureLocations?.paragraphs
            ? [['structureLocations', 'paragraphs']]
            : []),
    ]
}

/** 公开投影单独验证可见字段；完整持久化报告继续使用原有严格评分校验。 */
export const projectedCheckupReportSchema = projectedReportShape.superRefine((report, context) => {
    const policy = report.reportAccess
    if (isFullReportAccess(policy)) {
        if (report.comparisonNotes.length > policy.sections.comparisonNotes.limit)
            context.addIssue({
                code: 'custom',
                path: ['comparisonNotes'],
                message: 'Report exceeds saved comparison limit',
            })
        const saved = Object.fromEntries(
            Object.entries(report).filter(([key]) => key !== 'reportAccess'),
        )
        const full = checkupReportSchema.safeParse(saved)
        if (!full.success) for (const issue of full.error.issues) context.addIssue(issue)
        return
    }
    const restricted = RESTRICTED_REPORT_OMISSIONS.filter((field) => report[field] !== undefined)
    const maximum = policy.sections.comparisonNotes.enabled
        ? policy.sections.comparisonNotes.limit
        : 0
    const visibleIds = new Set(report.comparisonNotes.map((note) => note.noteId))
    const invalidWeakness = report.contentAnalysis?.weaknesses?.some((item) =>
        item.referenceIds.some((id) => !visibleIds.has(id)),
    )
    const invalidScore =
        report.primaryScore?.source === 'insight' &&
        report.primaryScore.value !== report.insight?.score
    const issues: string[][] = [
        ...restricted.map((field) => [field]),
        ...contentIssues(report, policy),
        ...structureIssues(report, policy),
        ...(report.comparisonNotes.length > maximum ? [['comparisonNotes']] : []),
        ...(invalidWeakness ? [['contentAnalysis', 'weaknesses']] : []),
        ...(invalidScore ? [['primaryScore']] : []),
    ]
    for (const path of issues)
        context.addIssue({ code: 'custom', path, message: 'Report contains inaccessible content' })
})

export type ProjectedCheckupReport = z.infer<typeof projectedCheckupReportSchema>
