import { ref } from 'vue'
import { SHOW_RADAR_REPORT } from '@/utils/reportPresentation'

import type { AnalysisResult } from './analysis.contract'
import { radarMetricNames } from './analysis.checkup-contract'
import { analysisUiConstraints } from './analysis.constants'
import { visibleRadar } from './analysis.radar-view'
import { readPrimaryScore } from './analysis.primary-score'
import { formatEngagementTier } from './analysis.engagement-display'
import { selectionReason, type SelectionReason } from './analysis.selection-reason'
import { contentAnalysisCopyLines, type ContentAnalysisLabels } from './analysis.content-analysis'
import type { RiskMatch } from './analysis.risk-matches'
import {
    structureMetricNames,
    type StructureMetrics,
    type StructureReferences,
} from './analysis.structure-metrics'
const MINIMUM_REFERENCE_SAMPLES = 20

export type ResultCopyTarget = 'all'

/** 由当前界面语言提供的报告复制标签。 */
export interface ResultCopyLabels {
    contentAnalysis: ContentAnalysisLabels
    average: string
    metricUnavailable: string
    insight: string
    insightUnavailable: string
    metrics: Readonly<Record<(typeof radarMetricNames)[number], string>>
    referenceMean: string
    referenceMedian: string
    referenceRange: string
    referenceMax: string
    referenceMin: string
    referenceUnavailable: string
    selectionReasons?: Record<SelectionReason, string>
    missingUrl: string
    likes: string
    collects: string
    comments: string
    rapidGrowth: string
    structureMetric: (
        name: keyof StructureMetrics,
        value: number | null,
        reference: StructureReferences[keyof StructureMetrics],
    ) => string
}

export interface ClipboardWriter {
    writeText(text: string): Promise<void>
}

/** 显式控制结果详情展开状态。 */
export function useResultDetails(initialExpanded = false) {
    const expanded = ref(initialExpanded)

    /** 切换结果详情的展开状态 */
    function toggleDetails() {
        expanded.value = !expanded.value
    }

    return { expanded, toggleDetails }
}

/** 复制已保存的主分、差异和案例。 */
export function buildResultCopyText(
    result: AnalysisResult,
    labels: ResultCopyLabels,
    riskMatches: readonly RiskMatch[] = result.riskMatches ?? [],
): string {
    const decimals = analysisUiConstraints.scoreDisplayDecimalPlaces
    const savedReference = result.insight?.reference
    const reference =
        savedReference && savedReference.sampleCount >= MINIMUM_REFERENCE_SAMPLES
            ? savedReference
            : null
    const primaryScore = readPrimaryScore(result)
    return [
        `${primaryScore.source === 'radar_average' ? labels.average : labels.insight}: ${primaryScore.value.toFixed(decimals)} / 10`,
        ...(primaryScore.source === 'insight'
            ? [
                  `${labels.referenceMedian}: ${reference?.median.toFixed(decimals) ?? labels.referenceUnavailable}`,
                  `${labels.referenceMax}: ${reference?.max?.toFixed(decimals) ?? labels.referenceUnavailable}`,
                  `${labels.referenceMin}: ${reference?.min?.toFixed(decimals) ?? labels.referenceUnavailable}`,
              ]
            : []),
        ...(SHOW_RADAR_REPORT && visibleRadar(result)
            ? radarMetricNames.map(
                  (metric) =>
                      `${labels.metrics[metric]}: ${result.radar[metric]?.toFixed(decimals) ?? '\u2014'}`,
              )
            : []),
        ...(result.customMetrics ?? []).map(
            (item) =>
                `${item.name}: ${item.status === 'available' ? `${item.value}${item.unit ? ` ${item.unit}` : ''}` : labels.metricUnavailable}\n${item.description}`,
        ),
        ...contentAnalysisCopyLines(
            result.contentAnalysis,
            result.qualitativeConclusion.summary,
            result.comparisonNotes,
            labels.contentAnalysis,
        ),
        labels.contentAnalysis.risks,
        ...(result.riskReviewStatus === 'unavailable'
            ? [labels.contentAnalysis.riskReviewUnavailable ?? labels.contentAnalysis.fallback]
            : []),
        ...(riskMatches.length
            ? riskMatches.map(
                  (item) =>
                      `${item.term} — ${labels.contentAnalysis.locations[item.location]} · ${item.description}`,
              )
            : result.riskReviewStatus === 'unavailable'
              ? []
              : [labels.contentAnalysis.noRisks]),
        ...structureMetricNames.map((name) =>
            labels.structureMetric(
                name,
                result.structureMetrics[name],
                result.structureReferences[name],
            ),
        ),
        ...result.comparisonNotes.map((note) =>
            [
                note.title,
                note.bodyExcerpt,
                note.url ?? labels.missingUrl,
                ...(labels.selectionReasons
                    ? [labels.selectionReasons[selectionReason(note)]]
                    : []),
                ...(['likes', 'collects', 'comments'] as const).map(
                    (metric) =>
                        `${labels[metric]}: ${formatEngagementTier(metric, note[metric], labels.rapidGrowth)}`,
                ),
            ].join('\n'),
        ),
    ].join('\n\n')
}

/** 将指定结果部分写入剪贴板。 */
export async function copyResult(
    result: AnalysisResult,
    labels: ResultCopyLabels,
    writer: ClipboardWriter | undefined = globalThis.navigator?.clipboard,
    riskMatches: readonly RiskMatch[] = result.riskMatches ?? [],
): Promise<void> {
    if (!writer) {
        throw new Error('clipboard_unavailable')
    }
    await writer.writeText(buildResultCopyText(result, labels, riskMatches))
}
