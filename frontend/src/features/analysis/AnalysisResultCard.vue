<script setup lang="ts">
import { analysisUiConstraints } from './analysis.constants'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import InlineFeedback from '@/components/feedback/InlineFeedback.vue'
import type { FeedbackDismissPolicy, UiFeedback } from '@/components/feedback/feedback'
import { getFrontendRuntime } from '@/edition/runtime'
import AnalysisInsightSummary from './AnalysisInsightSummary.vue'
import AnalysisResultMedia from './AnalysisResultMedia.vue'
import AnalysisCopyNote from './AnalysisCopyNote.vue'
import { visibleRadar } from './analysis.radar-view'
import { SHOW_RADAR_REPORT } from '@/utils/reportPresentation'
import AnalysisRadarChart from './AnalysisRadarChart.vue'
import AnalysisComparisonReport from './AnalysisComparisonReport.vue'
import AnalysisContentAnalysis from './AnalysisContentAnalysis.vue'
import AnalysisRiskMatches from './AnalysisRiskMatches.vue'
import AnalysisRiskText from './AnalysisRiskText.vue'
import { resolveRiskMatches, riskTrackCodes } from './analysis.risk-matches'
import { formatTaskFieldValue } from './analysis.format'
import { isAnalysisResultExpired } from './analysis.result-expiration'
import type {
    AnalysisTask,
    AnalysisTrackDefinition,
    TaskFieldDefinition,
    TaskFieldValue,
} from './analysis.contract'
import type { LocalHistoryImageLoader, LocalHistoryRecord } from './localHistory'
import { copyResult, useResultDetails, type ResultCopyTarget } from './resultDetails'
import { radarMetricNames } from './analysis.checkup-contract'
import type { ResultCopyLabels } from './resultDetails'
import AnalysisCustomMetrics from './AnalysisCustomMetrics.vue'

const props = defineProps<{
    task: AnalysisTask
    resultFields: TaskFieldDefinition[]
    tracks: AnalysisTrackDefinition[]
    canReanalyze: boolean
    reanalysisBusy: boolean
    clock: number
    actionError: string
    viewContext: 'current' | 'history'
    historyRecord: LocalHistoryRecord | null
    loadOriginalImage: LocalHistoryImageLoader
}>()

const emit = defineEmits<{
    reanalyze: []
    'dismiss-error': []
}>()

const { t, n } = useI18n()
const runtime = getFrontendRuntime()
const { expanded: detailsExpanded, toggleDetails } = useResultDetails()
const copyBusy = ref<ResultCopyTarget | null>(null)
const copyFeedback = ref<{
    type: 'success' | 'error'
    target: ResultCopyTarget
} | null>(null)
const resultElement = ref<HTMLElement | null>(null)
const resultExtension = getFrontendRuntime().useResultExtension({
    task: () => props.task,
    viewContext: () => props.viewContext,
    element: resultElement,
})
const result = computed(() => {
    if (!props.task.result) {
        throw new Error('analysis_result_missing')
    }
    return props.task.result
})
const riskMatches = computed(() =>
    resolveRiskMatches(
        result.value.riskMatches,
        {
            title: props.task.standardTask.fields.title.value,
            body: props.task.standardTask.fields.body.value,
            topics: props.task.standardTask.fields.topics.value.join('\n'),
        },
        riskTrackCodes(result.value),
    ),
)
const radarReport = computed(() => visibleRadar(result.value))
const visibleResultFields = computed(() =>
    props.resultFields.filter(
        (field) =>
            field.name !== 'track' &&
            field.name !== 'customTrackName' &&
            props.task.standardTask.fields[field.name]?.value !== null,
    ),
)
const resultTrackNames = computed(() => {
    const codes = [
        ...new Set([
            result.value.primaryTrack,
            ...(result.value.secondaryTracks ??
                result.value.insight?.tracks?.map((track) => track.trackCode) ??
                []),
        ]),
    ]
    return codes
        .map((code) => {
            const track = props.tracks.find((item) => item.code === code)
            return track ? t(track.labelKey) : t('workspace.fields.autoPlaceholder')
        })
        .join(t('workspace.fields.listSeparator'))
})
const copyFeedbackMessage = computed(() => {
    if (!copyFeedback.value) {
        return ''
    }
    if (copyFeedback.value.type === 'error') {
        return t('workspace.copy.failure')
    }
    return t('workspace.copy.success', {
        target: t(`workspace.copy.targets.${copyFeedback.value.target}`),
    })
})
const isTaskExpired = computed(() =>
    isAnalysisResultExpired(props.historyRecord?.savedAt ?? null, props.clock),
)
interface ResultActionFeedbackPresentation {
    readonly source: 'expired' | 'action' | 'copy'
    readonly feedback: UiFeedback
    readonly dismissPolicy: FeedbackDismissPolicy
}
const resultActionFeedback = computed<ResultActionFeedbackPresentation | null>(() => {
    if (isTaskExpired.value) {
        return {
            source: 'expired',
            dismissPolicy: 'persistent',
            feedback: {
                key: 'analysis.result.expired',
                scope: 'module',
                tone: 'error',
                message: t('workspace.versions.expired'),
            },
        }
    }
    if (props.actionError) {
        return {
            source: 'action',
            dismissPolicy: 'after-interaction',
            feedback: {
                key: 'analysis.result.action',
                scope: 'module',
                tone: 'error',
                message: props.actionError,
                announce: 'assertive',
            },
        }
    }
    if (!copyFeedback.value) return null
    const isCopyError = copyFeedback.value.type === 'error'
    return {
        source: 'copy',
        dismissPolicy: isCopyError ? 'after-interaction' : 'persistent',
        feedback: {
            key: 'analysis.result.copy',
            scope: 'form',
            tone: isCopyError ? 'error' : 'success',
            message: copyFeedbackMessage.value,
            announce: isCopyError ? 'assertive' : 'polite',
        },
    }
})

/** 把任务字段值格式化为界面文本 */
function formatFieldValue(value: TaskFieldValue | undefined, field?: TaskFieldDefinition) {
    return formatTaskFieldValue(value, t, field)
}

/** 复制指定结果内容并更新反馈状态 */
async function handleCopy(target: ResultCopyTarget) {
    if (copyBusy.value !== null) {
        return
    }
    copyBusy.value = target
    copyFeedback.value = null
    try {
        const labels: ResultCopyLabels = {
            contentAnalysis: {
                title: t('workspace.checkup.contentAnalysis.title'),
                consistency: t('workspace.checkup.contentAnalysis.consistency'),
                risks: t('workspace.checkup.contentAnalysis.risks'),
                weaknesses: t('workspace.checkup.contentAnalysis.weaknesses'),
                noRisks: t('workspace.checkup.contentAnalysis.noRisks'),
                riskReviewUnavailable: t('workspace.checkup.contentAnalysis.riskReviewUnavailable'),
                noWeaknesses: t('workspace.checkup.contentAnalysis.noWeaknesses'),
                fallback: t('workspace.checkup.contentAnalysis.fallback'),
                scoreBlocked: t('workspace.checkup.contentAnalysis.scoreBlocked'),
                references: t('workspace.checkup.contentAnalysis.references'),
                stars: (count) => t('workspace.checkup.contentAnalysis.stars', { count }),
                locations: {
                    title: t('workspace.checkup.contentAnalysis.locations.title'),
                    body: t('workspace.checkup.contentAnalysis.locations.body'),
                    topics: t('workspace.checkup.contentAnalysis.locations.topics'),
                    cover: t('workspace.checkup.contentAnalysis.locations.cover'),
                    content: t('workspace.checkup.contentAnalysis.locations.content'),
                },
            },
            average: t('skillAuth.averageTitle'),
            metricUnavailable: t('skillAuth.metricUnavailable'),
            insight: t('skillAuth.insightTitle'),
            insightUnavailable: t('skillAuth.insightUnavailable'),
            metrics: Object.fromEntries(
                radarMetricNames.map((metric) => [
                    metric,
                    t(`workspace.checkup.metrics.${metric}`),
                ]),
            ) as ResultCopyLabels['metrics'],
            referenceMean: t('workspace.checkup.referenceMean'),
            referenceMedian: t('workspace.checkup.referenceMedian'),
            referenceMax: t('workspace.checkup.referenceMax'),
            referenceMin: t('workspace.checkup.referenceMin'),
            referenceUnavailable: t('workspace.checkup.referenceUnavailable'),
            selectionReasons: {
                high_exposure: t('workspace.checkup.selectionReasons.high_exposure'),
                rapid_growth: t('workspace.checkup.selectionReasons.rapid_growth'),
            },
            referenceRange: t('workspace.checkup.referenceRange'),
            missingUrl: t('workspace.checkup.missingNoteUrl'),
            likes: t('workspace.checkup.likes'),
            collects: t('workspace.checkup.collects'),
            comments: t('workspace.checkup.comments'),
            rapidGrowth: t('workspace.checkup.rapidGrowth'),
            structureMetric: (name, value, reference) => {
                const format = (number: number | null) =>
                    number === null
                        ? t('workspace.checkup.structureMetrics.unavailable')
                        : n(number, {
                              style: name === 'titleEmojiRatio' ? 'percent' : 'decimal',
                              maximumFractionDigits:
                                  analysisUiConstraints.scoreDisplayDecimalPlaces,
                          })
                const range = reference
                    ? t('workspace.checkup.structureMetrics.range', {
                          low: format(reference.low),
                          high: format(reference.high),
                      })
                    : t('workspace.checkup.structureMetrics.insufficient')
                return `${t(`workspace.checkup.structureMetrics.fields.${name}`)}: ${format(value)}\n${range}`
            },
        }
        await copyResult(result.value, labels, undefined, riskMatches.value)
        await resultExtension.onCopied(target)
        copyFeedback.value = { type: 'success', target }
    } catch {
        copyFeedback.value = { type: 'error', target }
    } finally {
        copyBusy.value = null
    }
}

function dismissCopyFeedback() {
    copyFeedback.value = null
}

function dismissResultActionFeedback() {
    const source = resultActionFeedback.value?.source
    if (source === 'action') {
        emit('dismiss-error')
    } else if (source === 'copy') {
        dismissCopyFeedback()
    }
}
</script>

<template>
    <article ref="resultElement" class="mt-4 space-y-6" data-testid="analysis-result">
        <header class="space-y-4">
            <div
                v-guide-anchor="'onboarding.analysis-result.actions'"
                class="flex flex-wrap justify-end gap-2"
                data-testid="analysis-result-actions"
            >
                <button
                    class="min-h-10 rounded-lg border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink transition hover:border-brand/50 hover:bg-brand/5 disabled:opacity-50"
                    type="button"
                    :disabled="copyBusy !== null"
                    @click="handleCopy('all')"
                >
                    {{
                        copyBusy === 'all'
                            ? t('workspace.copy.copying')
                            : t('workspace.checkup.copyReport')
                    }}
                </button>
                <button
                    v-if="canReanalyze"
                    class="min-h-10 rounded-lg border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink transition hover:border-brand/50 hover:bg-brand/5 disabled:opacity-50"
                    type="button"
                    :disabled="reanalysisBusy"
                    @click="emit('reanalyze')"
                >
                    {{
                        reanalysisBusy
                            ? t('workspace.versions.reanalyzing')
                            : runtime.analysisText('reanalyze', { task }) ||
                                t('workspace.versions.reanalyze')
                    }}
                </button>
            </div>

            <InlineFeedback
                v-if="resultActionFeedback"
                :feedback="resultActionFeedback.feedback"
                :dismiss-policy="resultActionFeedback.dismissPolicy"
                @dismiss="dismissResultActionFeedback"
            />

            <div>
                <p class="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                    {{ t('workspace.checkup.eyebrow') }}
                </p>
                <h1 class="mt-2 text-2xl font-semibold tracking-tight text-ink">
                    {{ t('workspace.checkup.title') }}
                </h1>
            </div>
        </header>

        <AnalysisInsightSummary :result="result" />

        <div
            v-if="SHOW_RADAR_REPORT && radarReport"
            v-guide-anchor="'onboarding.analysis-result.metrics'"
        >
            <AnalysisRadarChart :report="radarReport" :track-label="null" />
        </div>
        <section
            v-else-if="SHOW_RADAR_REPORT"
            class="rounded-2xl border border-line bg-surface p-5"
            data-testid="analysis-radar-unavailable"
        >
            <h2 class="text-sm font-semibold text-ink">{{ t('workspace.result.radar.title') }}</h2>
            <p class="mt-2 text-sm leading-6 text-muted">{{ t('workspace.radarInsufficient') }}</p>
            <dl class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div
                    v-for="metric in radarMetricNames"
                    :key="metric"
                    class="rounded-xl bg-surface-muted p-3"
                >
                    <dt class="text-xs text-muted">
                        {{ t(`workspace.checkup.metrics.${metric}`) }}
                    </dt>
                    <dd class="mt-1 text-sm font-semibold text-ink">
                        {{ result.radar[metric]?.toFixed(2) ?? '—'
                        }}<span v-if="result.radar[metric] !== null"> / 10</span>
                    </dd>
                </div>
            </dl>
        </section>

        <AnalysisCustomMetrics :metrics="result.customMetrics ?? []" />
        <AnalysisContentAnalysis :result="result">
            <template #footer>
                <AnalysisRiskMatches
                    :matches="riskMatches"
                    :review-status="result.riskReviewStatus"
                />
            </template>
        </AnalysisContentAnalysis>
        <AnalysisComparisonReport :result="result" />

        <section class="rounded-2xl border border-line bg-surface">
            <button
                class="flex min-h-12 w-full items-center justify-between gap-3 px-5 py-3 text-left text-sm font-semibold text-ink"
                type="button"
                :aria-expanded="detailsExpanded"
                @click="toggleDetails"
            >
                {{ t('workspace.result.taskDetails') }}
                <span aria-hidden="true">{{ detailsExpanded ? '−' : '+' }}</span>
            </button>
            <dl v-if="detailsExpanded" class="grid gap-3 border-t border-line p-5 sm:grid-cols-2">
                <div
                    class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-xl bg-surface-muted p-3 sm:col-span-2"
                    data-testid="analysis-result-tracks"
                >
                    <dt class="text-xs text-muted">{{ t('workspace.result.keywords') }}</dt>
                    <dd class="col-start-1 mt-1 break-words text-sm text-ink">
                        {{ resultTrackNames }}
                    </dd>
                    <dd class="col-start-2 row-span-2 row-start-1">
                        <AnalysisCopyNote :key="task.id" :task="task" />
                    </dd>
                </div>
                <template v-for="field in visibleResultFields" :key="field.name">
                    <div class="rounded-xl bg-surface-muted p-3">
                        <dt class="text-xs text-muted">{{ t(field.labelKey) }}</dt>
                        <dd class="mt-1 text-sm text-ink">
                            <AnalysisRiskText
                                :text="
                                    formatFieldValue(
                                        task.standardTask.fields[field.name]?.value,
                                        field,
                                    )
                                "
                                :terms="
                                    riskMatches
                                        .filter((risk) => risk.location === field.name)
                                        .map((risk) => risk.term)
                                "
                            />
                        </dd>
                    </div>
                </template>
                <div class="rounded-xl bg-surface-muted p-3">
                    <dt class="sr-only">{{ t('workspace.result.media.images') }}</dt>
                    <dd>
                        <AnalysisResultMedia
                            :task="task"
                            :view-context="viewContext"
                            :history-record="historyRecord"
                            :load-original-image="loadOriginalImage"
                        />
                    </dd>
                </div>
            </dl>
        </section>

        <component
            :is="resultExtension.component"
            v-if="resultExtension.component"
            v-bind="resultExtension.bindings.value"
        />
        <p v-if="historyRecord" class="text-xs text-muted">
            {{ t('workspace.checkup.savedReport') }}
        </p>
    </article>
</template>
