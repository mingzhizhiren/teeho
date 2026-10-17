import { z } from 'zod'
import {
    canShowContentIndicator,
    canShowReportSection,
    canShowStructureMetric,
    hasFullReportAccess,
    type ReportAccess,
} from './analysis.report-access'
import type { ProjectedContentAnalysis } from './analysis.content-analysis'
import type { RiskMatch } from './analysis.risk-matches'
import {
    structureMetricNames,
    type StructureLocations,
    type StructureMetrics,
    type StructureReferences,
} from './analysis.structure-metrics'

interface ProjectedReport {
    reportAccess: ReportAccess
    structureMetrics: Partial<StructureMetrics>
    structureReferences: Partial<StructureReferences>
    structureLocations?: Partial<StructureLocations>
    contentAnalysis?: ProjectedContentAnalysis
    riskReviewStatus?: 'completed' | 'unavailable'
    riskMatches?: readonly RiskMatch[]
    comparisonNotes: ReadonlyArray<{ noteId: string }>
    primaryScore?: { source: 'insight' | 'radar_average'; value: number }
    insight: { score: number } | null
}

/** 拒绝受限 DTO 中夹带隐藏结果、超额参考或不可见指标的定位信息。 */
export function validateProjectedReportAccess(
    report: ProjectedReport,
    context: z.RefinementCtx,
): void {
    const invalid = (path: string[]) =>
        context.addIssue({ code: 'custom', path, message: 'Invalid projected report' })
    const access = report.reportAccess
    if (hasFullReportAccess(access)) invalid(['reportAccess'])
    const content = report.contentAnalysis
    if (!canShowReportSection(access, 'contentAnalysis') && content) invalid(['contentAnalysis'])
    for (const indicator of ['consistency', 'advice', 'weaknesses', 'termRisks'] as const) {
        if (!canShowContentIndicator(access, indicator) && content?.[indicator] !== undefined)
            invalid(['contentAnalysis', indicator])
    }
    if (
        !canShowContentIndicator(access, 'consistency') &&
        (content?.originalScore !== undefined || content?.scorePolicy !== undefined)
    )
        invalid(['contentAnalysis', 'originalScore'])
    if (
        !canShowContentIndicator(access, 'advice') &&
        content?.weaknesses?.some((item) => item.suggestion !== undefined)
    )
        invalid(['contentAnalysis', 'weaknesses'])
    if (!canShowContentIndicator(access, 'termRisks')) {
        if (report.riskReviewStatus !== undefined) invalid(['riskReviewStatus'])
        if (report.riskMatches !== undefined) invalid(['riskMatches'])
    }
    for (const metric of structureMetricNames) {
        if (
            !canShowStructureMetric(access, metric) &&
            (report.structureMetrics[metric] !== undefined ||
                report.structureReferences[metric] !== undefined)
        )
            invalid(['structureMetrics', metric])
    }
    if (
        !canShowStructureMetric(access, 'maxTopicLength') &&
        report.structureLocations?.topics !== undefined
    )
        invalid(['structureLocations', 'topics'])
    if (
        !canShowStructureMetric(access, 'maxParagraphLength') &&
        report.structureLocations?.paragraphs !== undefined
    )
        invalid(['structureLocations', 'paragraphs'])
    const limit = canShowReportSection(access, 'comparisonNotes')
        ? access.sections.comparisonNotes.limit
        : 0
    if (report.comparisonNotes.length > limit) invalid(['comparisonNotes'])
    const ids = new Set(report.comparisonNotes.map((note) => note.noteId))
    if (content?.weaknesses?.some((item) => item.referenceIds.some((id) => !ids.has(id))))
        invalid(['contentAnalysis', 'weaknesses'])
    const primary = report.primaryScore
    if (!primary && !report.insight) invalid(['primaryScore'])
    if (
        primary?.source === 'insight' &&
        (!report.insight || primary.value !== report.insight.score)
    )
        invalid(['primaryScore'])
    if (primary?.source === 'radar_average' && report.insight) invalid(['insight'])
    if (
        content?.status === 'completed' &&
        content.consistency?.stars === 0 &&
        (primary?.value ?? report.insight?.score) !== 0
    )
        invalid(['primaryScore'])
}
