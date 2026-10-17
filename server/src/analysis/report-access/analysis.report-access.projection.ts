import { checkupReportSchema, type CheckupReport } from '../checkup/analysis.checkup.contract'
import {
    isFullReportAccess,
    reportAccessPolicySchema,
    type ReportAccessPolicy,
} from './analysis.report-access.policy'
import {
    projectedCheckupReportSchema,
    type ProjectedCheckupReport,
} from './analysis.report-access.schema'
import type { StructureMetricIndicator } from './analysis.report-access.registry'

export { projectedCheckupReportSchema, type ProjectedCheckupReport }

function projectContent(
    report: CheckupReport,
    policy: ReportAccessPolicy,
    visibleIds: ReadonlySet<string>,
): ProjectedCheckupReport['contentAnalysis'] {
    const source = report.contentAnalysis
    const { enabled, indicators } = policy.sections.contentAnalysis
    if (!source || !enabled || !Object.values(indicators).some(Boolean)) return undefined
    const weaknesses = source.weaknesses
        .filter((item) => item.referenceIds.every((id) => visibleIds.has(id)))
        .map((item) => {
            if (indicators.advice) return item
            return {
                location: item.location,
                evidence: item.evidence,
                description: item.description,
                referenceIds: item.referenceIds,
            }
        })
    return {
        status: source.status,
        ...(source.evaluationVersion && { evaluationVersion: source.evaluationVersion }),
        ...(indicators.consistency && {
            consistency: source.consistency,
            originalScore: source.originalScore,
            ...(source.scorePolicy && { scorePolicy: source.scorePolicy }),
        }),
        ...(indicators.advice && source.advice !== undefined && { advice: source.advice }),
        ...(indicators.weaknesses && { weaknesses }),
        ...(indicators.termRisks && { termRisks: source.termRisks }),
    }
}

function projectStructure<T extends Partial<Record<StructureMetricIndicator, unknown>>>(
    source: T,
    policy: ReportAccessPolicy,
): Partial<T> {
    const { enabled, indicators } = policy.sections.structureMetrics
    return Object.fromEntries(
        Object.entries(source).filter(
            ([key]) => enabled && indicators[key as StructureMetricIndicator],
        ),
    ) as Partial<T>
}

function projectLocations(
    report: CheckupReport,
    policy: ReportAccessPolicy,
): ProjectedCheckupReport['structureLocations'] {
    const source = report.structureLocations
    const { enabled, indicators } = policy.sections.structureMetrics
    if (!source || !enabled) return undefined
    const locations = {
        ...(indicators.maxTopicLength && { topics: source.topics }),
        ...(indicators.maxParagraphLength && { paragraphs: source.paragraphs }),
    }
    return Object.keys(locations).length ? locations : undefined
}

/** 根据已冻结权限生成交付报告；完整报告、评分、历史数据均不被改写或重新计算。 */
export function projectCheckupReport(
    report: CheckupReport,
    access: ReportAccessPolicy,
): ProjectedCheckupReport {
    const saved = checkupReportSchema.parse(report)
    const policy = reportAccessPolicySchema.parse(access)
    if (isFullReportAccess(policy))
        return projectedCheckupReportSchema.parse({ ...saved, reportAccess: policy })
    const comparisons = policy.sections.comparisonNotes
    const comparisonNotes = comparisons.enabled
        ? saved.comparisonNotes.slice(0, comparisons.limit)
        : []
    const visibleIds = new Set(comparisonNotes.map((note) => note.noteId))
    const contentAnalysis = projectContent(saved, policy, visibleIds)
    const structureLocations = projectLocations(saved, policy)
    const content = policy.sections.contentAnalysis
    return projectedCheckupReportSchema.parse({
        schemaVersion: saved.schemaVersion,
        reportAccess: policy,
        primaryTrack: saved.primaryTrack,
        insight: saved.insight,
        comparisonNotes,
        structureMetrics: projectStructure(saved.structureMetrics, policy),
        structureReferences: projectStructure(saved.structureReferences, policy),
        ...(saved.primaryScore && { primaryScore: saved.primaryScore }),
        ...(saved.secondaryTracks && { secondaryTracks: saved.secondaryTracks }),
        ...(saved.referenceRequirement && { referenceRequirement: saved.referenceRequirement }),
        ...(saved.structureMetricsVersion && {
            structureMetricsVersion: saved.structureMetricsVersion,
        }),
        ...(saved.structureReferencePolicy && {
            structureReferencePolicy: saved.structureReferencePolicy,
        }),
        ...(contentAnalysis && { contentAnalysis }),
        ...(structureLocations && { structureLocations }),
        ...(content.enabled &&
            content.indicators.termRisks &&
            saved.riskMatches !== undefined && {
                riskMatches: saved.riskMatches,
            }),
        ...(content.enabled &&
            content.indicators.termRisks &&
            saved.riskReviewStatus && {
                riskReviewStatus: saved.riskReviewStatus,
            }),
    })
}
