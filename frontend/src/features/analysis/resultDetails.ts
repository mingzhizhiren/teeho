import { ref } from 'vue'
import { SHOW_RADAR_REPORT } from '@/utils/reportPresentation'

import type { AnalysisResult } from './analysis.contract'
import { radarMetricNames } from './analysis.checkup-contract'
import { analysisUiConstraints } from './analysis.constants'
import { visibleRadar } from './analysis.radar-view'
import { readPrimaryScore } from './analysis.primary-score'
import { presentReference, type SelectionReason } from './analysis.selection-reason'
import { contentAnalysisCopyLines, type ContentAnalysisLabels } from './analysis.content-analysis'
import {
    canShowContentIndicator,
    canShowReportSection,
    canShowStructureMetric,
} from './analysis.report-access'
import {
    visibleStructureMetricNames,
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
    referenceWeightedMedian?: string
    referenceWeightedRange?: string
    referenceWeightedMax?: string
    referenceWeightedMin?: string
    selectionReasons?: Record<SelectionReason, string>
    referenceModelScore?: string
    semanticReference?: string
    missingUrl: string
    likes: string
    collects: string
    comments: string
    rapidGrowth: string
    paragraphLocation?: (number: number, text: string) => string
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
export function buildResultCopyText(result: AnalysisResult, labels: ResultCopyLabels): string {
    const riskMatches = result.riskMatches
    const decimals = analysisUiConstraints.scoreDisplayDecimalPlaces
    const savedReference = result.insight?.reference
    const reference =
        savedReference && savedReference.sampleCount >= MINIMUM_REFERENCE_SAMPLES
            ? savedReference
            : null
    const primaryScore = readPrimaryScore(result)
    const weighted = reference?.contentType && reference.aggregation === 'weighted_tracks'
    const referenceLabel = (kind: 'Median' | 'Range' | 'Max' | 'Min'): string =>
        (weighted ? labels[`referenceWeighted${kind}`] : undefined) ?? labels[`reference${kind}`]
    return [
        `${primaryScore.source === 'radar_average' ? labels.average : labels.insight}: ${primaryScore.value.toFixed(decimals)} / 10`,
        ...(primaryScore.source === 'insight'
            ? [
                  `${referenceLabel('Median')}: ${reference?.median.toFixed(decimals) ?? labels.referenceUnavailable}`,
                  ...(reference?.contentType
                      ? [
                            `${referenceLabel('Range')}: ${reference.p10.toFixed(decimals)} ~ ${reference.p90.toFixed(decimals)}`,
                        ]
                      : []),
                  `${referenceLabel('Max')}: ${reference?.max?.toFixed(decimals) ?? labels.referenceUnavailable}`,
                  `${referenceLabel('Min')}: ${reference?.min?.toFixed(decimals) ?? labels.referenceUnavailable}`,
              ]
            : []),
        ...(SHOW_RADAR_REPORT && visibleRadar(result)
            ? radarMetricNames.map(
                  (metric) =>
                      `${labels.metrics[metric]}: ${result.radar?.[metric]?.toFixed(decimals) ?? '\u2014'}`,
              )
            : []),
        ...(result.customMetrics ?? []).map(
            (item) =>
                `${item.name}: ${item.status === 'available' ? `${item.value}${item.unit ? ` ${item.unit}` : ''}` : labels.metricUnavailable}\n${item.description}`,
        ),
        ...contentAnalysisCopyLines(
            result.contentAnalysis,
            result.qualitativeConclusion?.summary ?? '',
            result.comparisonNotes,
            labels.contentAnalysis,
            result.reportAccess,
        ),
        ...(canShowContentIndicator(result.reportAccess, 'termRisks')
            ? [
                  labels.contentAnalysis.risks,
                  ...(result.riskReviewStatus === 'unavailable'
                      ? [
                            labels.contentAnalysis.riskReviewUnavailable ??
                                labels.contentAnalysis.fallback,
                        ]
                      : []),
                  ...(riskMatches?.length
                      ? riskMatches.map(
                            (item) =>
                                `${item.term} — ${labels.contentAnalysis.locations[item.location]} · ${item.description}`,
                        )
                      : riskMatches === undefined
                        ? [labels.contentAnalysis.riskResultsMissing]
                        : result.riskReviewStatus === 'unavailable'
                          ? []
                          : [labels.contentAnalysis.noRisks]),
              ]
            : []),
        ...visibleStructureMetricNames(result.structureMetrics, result.structureReferences)
            .filter((name) => canShowStructureMetric(result.reportAccess, name))
            .map((name) =>
                [
                    labels.structureMetric(
                        name,
                        result.structureMetrics[name] ?? null,
                        result.structureReferences[name],
                    ),
                    ...(name === 'maxTopicLength'
                        ? (result.structureLocations?.topics ?? []).map((item) => item.text)
                        : []),
                    ...(name === 'maxParagraphLength'
                        ? (result.structureLocations?.paragraphs ?? []).map(
                              (item) =>
                                  labels.paragraphLocation?.(item.number, item.text) ??
                                  `${item.number}: ${item.text}`,
                          )
                        : []),
                ].join('\n'),
            ),
        ...(canShowReportSection(result.reportAccess, 'comparisonNotes')
            ? result.comparisonNotes
                  .slice(0, result.reportAccess?.sections.comparisonNotes.limit)
                  .map((note) => {
                      const presentation = presentReference(note, labels)
                      return [
                          note.title,
                          ...(note.modelScore != null && labels.referenceModelScore
                              ? [
                                    `${labels.referenceModelScore}: ${note.modelScore.toFixed(decimals)} / 10`,
                                ]
                              : []),
                          note.bodyExcerpt,
                          ...(note.topics?.length
                              ? [note.topics.map((topic) => `#${topic}`).join(' ')]
                              : []),
                          note.url ?? labels.missingUrl,
                          ...(presentation.reason ? [presentation.reason] : []),
                          ...(['likes', 'collects', 'comments'] as const).map(
                              (metric) => `${labels[metric]}: ${presentation.counts[metric]}`,
                          ),
                      ].join('\n')
                  })
            : []),
        ...(result.reportAccess?.footer ? [result.reportAccess.footer] : []),
    ].join('\n\n')
}

/** 将指定结果部分写入剪贴板。 */
export async function copyResult(
    result: AnalysisResult,
    labels: ResultCopyLabels,
    writer: ClipboardWriter | undefined = globalThis.navigator?.clipboard,
): Promise<void> {
    if (!writer) {
        throw new Error('clipboard_unavailable')
    }
    await writer.writeText(buildResultCopyText(result, labels))
}
