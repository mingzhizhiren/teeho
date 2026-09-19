<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/icons/AppIcon.vue'
import type { RadarScores } from './analysis.checkup-contract'
import { analysisUiConstraints } from './analysis.constants'

import {
    analysisRadarEmbers as radarEmbers,
    analysisRadarEmberStyle as emberStyle,
} from './analysis.radar-embers'
import {
    analysisRadarMetricOrder,
    createRadarPoints,
    type AnalysisRadarMetric,
    type RadarPoint,
} from './analysis.radar'

const props = defineProps<{
    report: RadarScores
    trackLabel: string | null
}>()

const { t } = useI18n()
const activeHelpMetric = ref<AnalysisRadarMetric | null>(null)
const RADAR_DISPLAY_SCALE = 10
const SCORE_DECIMALS = 2
const metricHelpPanelId = 'analysis-metric-help'
const radarGeometry = {
    centerX: 220,
    centerY: 185,
    radius: 110,
} as const
const firstGridFraction = 0.2
const secondGridFraction = 0.4
const thirdGridFraction = 0.6
const fourthGridFraction = 0.8
const radarGridLevels = [
    analysisUiConstraints.scoreMaximum * firstGridFraction,
    analysisUiConstraints.scoreMaximum * secondGridFraction,
    analysisUiConstraints.scoreMaximum * thirdGridFraction,
    analysisUiConstraints.scoreMaximum * fourthGridFraction,
    analysisUiConstraints.scoreMaximum,
] as const

const reportScores = computed(() => analysisRadarMetricOrder.map((metric) => props.report[metric]))
const hasCompleteShape = computed(() => reportScores.value.every((score) => score !== null))
const dataPoints = computed(() =>
    createRadarPoints(
        reportScores.value.map((score) => (score ?? 0) * RADAR_DISPLAY_SCALE),
        radarGeometry,
    ),
)
const visiblePoints = computed(() =>
    dataPoints.value.flatMap((point, index) =>
        reportScores.value[index] === null
            ? []
            : [{ ...point, metric: analysisRadarMetricOrder[index]! }],
    ),
)
const partialPath = computed(() =>
    dataPoints.value
        .map((point, index) => {
            const next = (index + 1) % dataPoints.value.length
            return reportScores.value[index] === null || reportScores.value[next] === null
                ? ''
                : `M${point.x},${point.y} L${dataPoints.value[next]!.x},${dataPoints.value[next]!.y}`
        })
        .join(' '),
)
const displayScore = (score: number | null): string =>
    score === null ? '—' : score.toFixed(SCORE_DECIMALS)
const gridPolygons = radarGridLevels.map((level) =>
    createRadarPoints(
        analysisRadarMetricOrder.map(() => level),
        radarGeometry,
    ),
)
function pointsAttribute(points: readonly RadarPoint[]): string {
    return points.map((point) => `${point.x},${point.y}`).join(' ')
}

function isMetricFocused(metric: AnalysisRadarMetric): boolean {
    return activeHelpMetric.value === null || activeHelpMetric.value === metric
}

function toggleMetricHelp(metric: AnalysisRadarMetric): void {
    activeHelpMetric.value = activeHelpMetric.value === metric ? null : metric
}

function labelPosition(index: number): {
    x: number
    y: number
    anchor: 'start' | 'middle' | 'end'
} {
    const positions = [
        { x: 220, y: 37, anchor: 'middle' },
        { x: 388, y: 123, anchor: 'end' },
        { x: 388, y: 275, anchor: 'end' },
        { x: 220, y: 345, anchor: 'middle' },
        { x: 52, y: 275, anchor: 'start' },
        { x: 52, y: 123, anchor: 'start' },
    ] as const
    return positions[index]!
}

function helpPosition(index: number): { x: number; y: number } {
    const positions = [
        { x: 284, y: 37 },
        { x: 408, y: 116 },
        { x: 408, y: 268 },
        { x: 278, y: 338 },
        { x: 32, y: 268 },
        { x: 32, y: 116 },
    ] as const
    return positions[index]!
}
</script>

<template>
    <section
        class="radar-card relative overflow-hidden rounded-3xl border border-brand/20 bg-surface p-5 sm:p-6"
        data-testid="analysis-radar-card"
    >
        <div class="radar-card-glow" aria-hidden="true"></div>

        <div class="relative z-10 flex flex-wrap items-start justify-between gap-3">
            <div>
                <div class="flex flex-wrap items-center gap-2">
                    <p class="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
                        {{ t('workspace.checkup.scoreTitle') }}
                    </p>
                    <span
                        v-if="trackLabel"
                        class="rounded-full border border-brand/25 bg-brand/10 px-2.5 py-1 text-xs font-semibold text-brand"
                        data-testid="analysis-track-badge"
                    >
                        {{ trackLabel }}
                    </span>
                </div>
            </div>
        </div>

        <div class="relative z-10 mt-5">
            <div
                class="radar-stage order-1 relative min-w-0 overflow-hidden rounded-[2rem] border border-line px-2 py-5 sm:px-4 lg:order-2"
                data-testid="analysis-radar-stage"
            >
                <div class="radar-ember-field" aria-hidden="true">
                    <span
                        v-for="ember in radarEmbers"
                        :key="ember.id"
                        class="radar-ember"
                        :class="`radar-ember-${ember.variant}`"
                        :style="emberStyle(ember)"
                        data-radar-role="ember"
                    ></span>
                </div>
                <div class="radar-glass-orb" data-testid="analysis-radar-glass" aria-hidden="true">
                    <span class="radar-glass-highlight"></span>
                    <span class="radar-glass-ring"></span>
                </div>

                <svg
                    class="relative z-10 mx-auto h-auto w-full max-w-2xl overflow-visible"
                    viewBox="0 0 440 370"
                    role="img"
                    :aria-labelledby="'analysis-radar-title analysis-radar-description'"
                    data-testid="analysis-radar"
                >
                    <title id="analysis-radar-title">
                        {{ t('workspace.result.radar.title') }}
                    </title>
                    <desc id="analysis-radar-description">
                        {{ t('workspace.result.radar.description') }}
                    </desc>
                    <defs>
                        <linearGradient id="radar-area-fill" x1="0" y1="0" x2="1" y2="1">
                            <stop stop-color="rgb(var(--color-brand-glow))" stop-opacity="0.26" />
                            <stop
                                offset="0.48"
                                stop-color="rgb(var(--color-brand))"
                                stop-opacity="0.19"
                            />
                            <stop
                                offset="1"
                                stop-color="rgb(var(--color-brand-hover))"
                                stop-opacity="0.14"
                            />
                        </linearGradient>
                        <linearGradient id="radar-stroke" x1="0" y1="0" x2="0" y2="1">
                            <stop stop-color="rgb(var(--color-brand-glow))" stop-opacity="0.68" />
                            <stop
                                offset="0.42"
                                stop-color="rgb(var(--color-brand))"
                                stop-opacity="0.64"
                            />
                            <stop
                                offset="1"
                                stop-color="rgb(var(--color-brand-hover))"
                                stop-opacity="0.56"
                            />
                        </linearGradient>
                        <filter id="radar-data-halo" x="-50%" y="-50%" width="200%" height="200%">
                            <feGaussianBlur stdDeviation="7" />
                        </filter>
                        <filter id="radar-data-glow" x="-40%" y="-40%" width="180%" height="180%">
                            <feGaussianBlur stdDeviation="1.6" result="blur" />
                            <feMerge>
                                <feMergeNode in="blur" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                    </defs>

                    <polygon
                        v-for="(polygon, index) in gridPolygons"
                        :key="radarGridLevels[index]"
                        :points="pointsAttribute(polygon)"
                        fill="none"
                        class="radar-grid-polygon stroke-line"
                        stroke-width="1"
                    />

                    <g v-for="(metric, index) in analysisRadarMetricOrder" :key="metric">
                        <text
                            data-radar-role="label"
                            :data-metric="metric"
                            :x="labelPosition(index).x"
                            :y="labelPosition(index).y"
                            :text-anchor="labelPosition(index).anchor"
                            :class="isMetricFocused(metric) ? 'fill-ink' : 'fill-muted opacity-35'"
                            class="text-[13px] font-semibold transition-opacity"
                        >
                            <tspan>{{ t(`workspace.checkup.metrics.${metric}`) }}</tspan>
                            <tspan
                                :x="labelPosition(index).x"
                                dy="18"
                                class="fill-brand text-[12px] font-bold"
                            >
                                {{ displayScore(report[metric]) }}
                            </tspan>
                        </text>
                        <g
                            data-radar-role="metric-help"
                            :data-metric="metric"
                            class="radar-help-button"
                            :class="{ 'is-active': activeHelpMetric === metric }"
                            :transform="`translate(${helpPosition(index).x} ${helpPosition(index).y})`"
                            role="button"
                            tabindex="0"
                            :aria-label="
                                t('workspace.result.metricHelp.metricButton', {
                                    metric: t(`workspace.checkup.metrics.${metric}`),
                                })
                            "
                            :aria-expanded="activeHelpMetric === metric"
                            :aria-controls="metricHelpPanelId"
                            @click="toggleMetricHelp(metric)"
                            @keydown.enter.prevent="toggleMetricHelp(metric)"
                            @keydown.space.prevent="toggleMetricHelp(metric)"
                        >
                            <title>
                                {{ t(`workspace.checkup.metricHelp.${metric}.question`) }}
                            </title>
                            <circle class="radar-help-hit" r="32"></circle>
                            <circle class="radar-help-control" r="8"></circle>
                            <text y="3.5" text-anchor="middle">?</text>
                        </g>
                    </g>

                    <polygon
                        v-if="hasCompleteShape"
                        :points="pointsAttribute(dataPoints)"
                        fill="none"
                        class="radar-data-halo"
                        filter="url(#radar-data-halo)"
                        stroke-linejoin="round"
                        stroke-width="8"
                    />
                    <polygon
                        v-if="hasCompleteShape"
                        :points="pointsAttribute(dataPoints)"
                        fill="url(#radar-area-fill)"
                        class="radar-data-main"
                        filter="url(#radar-data-glow)"
                        stroke-linejoin="round"
                        stroke-width="3"
                    />
                    <polygon
                        v-if="hasCompleteShape"
                        :points="pointsAttribute(dataPoints)"
                        fill="none"
                        class="radar-data-inner"
                        stroke-dasharray="7 12"
                        stroke-linejoin="round"
                        stroke-width="1"
                    />
                    <path
                        v-if="!hasCompleteShape"
                        :d="partialPath"
                        fill="none"
                        class="stroke-brand"
                        stroke-width="3"
                    />
                    <circle
                        v-for="point in visiblePoints"
                        :key="point.metric"
                        data-radar-role="vertex"
                        :data-metric="point.metric"
                        :cx="point.x"
                        :cy="point.y"
                        :r="isMetricFocused(point.metric) ? 5 : 3"
                        :class="
                            isMetricFocused(point.metric)
                                ? 'radar-vertex-active'
                                : 'radar-vertex-muted opacity-35'
                        "
                        filter="url(#radar-data-glow)"
                        stroke-width="2"
                    />
                </svg>
            </div>
        </div>

        <div
            v-if="activeHelpMetric"
            :id="metricHelpPanelId"
            class="metric-help-panel relative z-10 mt-4 rounded-2xl border border-line p-4 sm:p-5"
            :data-metric="activeHelpMetric"
            data-testid="analysis-metric-help"
            role="status"
            aria-live="polite"
        >
            <div class="flex items-start justify-between gap-4">
                <div>
                    <p class="text-xs font-semibold uppercase tracking-[0.16em] text-brand">
                        {{ t(`workspace.checkup.metrics.${activeHelpMetric}`) }}
                        · {{ displayScore(report[activeHelpMetric]) }}
                    </p>
                    <h3 class="mt-2 text-base font-bold leading-6 text-ink">
                        {{ t(`workspace.checkup.metricHelp.${activeHelpMetric}.question`) }}
                    </h3>
                </div>
                <button
                    class="grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-surface text-muted transition hover:border-brand/40 hover:text-ink"
                    type="button"
                    :aria-label="t('common.close')"
                    @click="activeHelpMetric = null"
                >
                    <AppIcon name="close" />
                </button>
            </div>
            <p class="mt-3 text-sm leading-6 text-muted">
                <span class="font-semibold text-ink">
                    {{ t('workspace.result.metricHelp.primarySignals') }}
                </span>
                {{ t(`workspace.checkup.metricHelp.${activeHelpMetric}.signals`) }}
            </p>
        </div>
    </section>
</template>

<style scoped>
.radar-card {
    isolation: isolate;
}

.radar-card-glow {
    position: absolute;
    inset: 0;
    background:
        radial-gradient(circle at 16% 12%, rgb(var(--color-brand-glow) / 0.1), transparent 28%),
        radial-gradient(circle at 86% 70%, rgb(var(--color-brand-hot) / 0.07), transparent 34%);
    pointer-events: none;
}

.radar-stage {
    isolation: isolate;
    background-color: rgb(var(--color-surface-muted));
    background-image:
        radial-gradient(ellipse at 50% 112%, rgb(var(--color-brand) / 0.2), transparent 46%),
        radial-gradient(circle at 16% 18%, rgb(var(--color-brand-glow) / 0.07), transparent 24%),
        radial-gradient(circle at 88% 16%, rgb(var(--color-brand) / 0.055), transparent 26%),
        linear-gradient(
            180deg,
            rgb(var(--color-surface) / 0.98),
            rgb(var(--color-surface-muted) / 0.94)
        );
}

.radar-stage::before {
    position: absolute;
    right: 8%;
    bottom: -20%;
    left: 8%;
    height: 48%;
    border-radius: 50%;
    background: radial-gradient(
        ellipse at center,
        rgb(var(--color-brand-glow) / 0.2),
        rgb(var(--color-brand) / 0.09) 36%,
        transparent 72%
    );
    content: '';
    filter: blur(1.125rem);
    pointer-events: none;
}

.radar-stage::after {
    position: absolute;
    inset: 0;
    background-image: radial-gradient(
        circle,
        rgb(var(--color-brand-glow) / 0.16) 0 1px,
        transparent 1.4px
    );
    background-size: 1.25rem 1.25rem;
    content: '';
    mask-image: linear-gradient(to top, black, transparent 64%);
    opacity: 0.18;
    pointer-events: none;
}

.radar-glass-orb {
    position: absolute;
    left: 50%;
    top: 50%;
    z-index: 2;
    width: min(58%, 25rem);
    aspect-ratio: 1;
    transform: translate(-50%, -50%);
    overflow: hidden;
    border: 1px solid rgb(var(--color-text) / 0.12);
    border-radius: 9999px;
    background:
        radial-gradient(circle at 29% 22%, rgb(var(--color-surface) / 0.82), transparent 27%),
        radial-gradient(circle at 68% 72%, rgb(var(--color-brand-vivid) / 0.09), transparent 42%),
        linear-gradient(
            145deg,
            rgb(var(--color-surface) / 0.5),
            rgb(var(--color-surface-muted) / 0.2)
        );
    box-shadow:
        inset 0 1px 0 rgb(var(--color-text) / 0.1),
        inset -1.5rem -1.8rem 3rem rgb(var(--color-brand-hot) / 0.045),
        0 1.5rem 4rem rgb(var(--color-text) / 0.1),
        0 0 3rem rgb(var(--color-brand-vivid) / 0.08);
    backdrop-filter: blur(18px) saturate(1.18);
}

.radar-glass-highlight {
    position: absolute;
    left: 17%;
    top: 10%;
    width: 52%;
    height: 23%;
    transform: rotate(-16deg);
    border-radius: 50%;
    background: linear-gradient(180deg, rgb(var(--color-surface) / 0.62), transparent);
    filter: blur(0.25rem);
}

.radar-glass-ring {
    position: absolute;
    inset: 5%;
    border: 1px solid rgb(var(--color-text) / 0.07);
    border-radius: inherit;
    box-shadow: inset 0 0 2.5rem rgb(var(--color-brand-glow) / 0.06);
}

.radar-ember-field {
    position: absolute;
    inset: 0;
    z-index: 1;
    overflow: hidden;
    pointer-events: none;
}

.radar-ember {
    position: absolute;
    left: var(--ember-x);
    bottom: -1.625rem;
    width: var(--ember-size);
    height: var(--ember-size);
    border-radius: 9999px;
    background: rgb(var(--color-brand-glow) / 0.92);
    box-shadow:
        0 0 0.375rem rgb(var(--color-brand-glow) / 0.72),
        0 0 0.875rem rgb(var(--color-brand) / 0.42);
    opacity: 0;
    animation: radar-ember-rise var(--ember-duration) linear var(--ember-delay) infinite;
    will-change: transform, opacity;
}

.radar-ember-hot {
    background: rgb(var(--color-brand-glow));
    box-shadow:
        0 0 0.3125rem rgb(var(--color-brand-glow) / 0.92),
        0 0 0.875rem rgb(var(--color-brand) / 0.58),
        0 0 1.4rem rgb(var(--color-brand-hover) / 0.22);
}

.radar-ember-trail {
    height: calc(var(--ember-size) * 4);
    filter: blur(0.0125rem);
}

.radar-ember-soft {
    background: rgb(var(--color-brand) / 0.72);
    box-shadow: 0 0 0.625rem rgb(var(--color-brand) / 0.3);
}

@keyframes radar-ember-rise {
    0% {
        transform: translate3d(0, 0, 0) scale(0.5);
        opacity: 0;
    }
    10% {
        opacity: var(--ember-opacity);
    }
    72% {
        opacity: var(--ember-opacity);
    }
    100% {
        transform: translate3d(var(--ember-drift), calc(-1 * var(--ember-rise)), 0) scale(0.18);
        opacity: 0;
    }
}

.dark .radar-stage {
    background-image:
        radial-gradient(ellipse at 50% 112%, rgb(var(--color-brand) / 0.24), transparent 48%),
        radial-gradient(circle at 16% 18%, rgb(var(--color-brand-glow) / 0.055), transparent 24%),
        radial-gradient(circle at 88% 16%, rgb(var(--color-brand-hover) / 0.08), transparent 26%),
        linear-gradient(
            180deg,
            rgb(var(--color-surface-muted) / 0.96),
            rgb(var(--color-canvas) / 0.98)
        );
}

.dark .radar-ember {
    filter: saturate(0.86);
}

.radar-grid-polygon {
    opacity: 0.52;
}

.radar-data-halo {
    stroke: rgb(var(--color-brand) / 0.13);
}

.radar-data-main {
    stroke: url(#radar-stroke);
}

.radar-data-inner {
    stroke: rgb(var(--color-brand-glow) / 0.4);
    animation: radar-edge-flow 6s linear infinite;
}

@keyframes radar-edge-flow {
    to {
        stroke-dashoffset: -76;
    }
}

.radar-vertex-active {
    fill: rgb(var(--color-surface));
    stroke: rgb(var(--color-brand));
}

.radar-vertex-muted {
    fill: rgb(var(--color-brand) / 0.3);
    stroke: rgb(var(--color-surface));
}

.radar-help-button {
    cursor: pointer;
    outline: none;
}

.radar-help-hit {
    fill: transparent;
    stroke: transparent;
    pointer-events: all;
}

.radar-help-control {
    fill: rgb(var(--color-surface) / 0.9);
    stroke: rgb(var(--color-border));
    stroke-width: 1.2;
    transition:
        fill 160ms ease,
        stroke 160ms ease,
        transform 160ms ease;
}

.radar-help-button text {
    fill: rgb(var(--color-text));
    font-size: 0.625rem;
    font-weight: 800;
    pointer-events: none;
}

.radar-help-button:hover .radar-help-control,
.radar-help-button:focus-visible .radar-help-control,
.radar-help-button.is-active .radar-help-control {
    fill: rgb(var(--color-brand));
    stroke: rgb(var(--color-brand));
    transform: scale(1.08);
}

.radar-help-button:hover text,
.radar-help-button:focus-visible text,
.radar-help-button.is-active text {
    fill: rgb(var(--color-on-brand));
}

.metric-help-panel {
    background:
        radial-gradient(circle at 8% 0%, rgb(var(--color-brand-glow) / 0.08), transparent 32%),
        rgb(var(--color-surface) / 0.9);
    box-shadow: 0 1rem 2.5rem rgb(var(--color-text) / 0.08);
    backdrop-filter: blur(14px);
}

@media (max-width: 639px) {
    .radar-stage {
        padding-inline: 0;
    }

    .radar-glass-orb {
        width: 64%;
    }
}

@media (prefers-reduced-motion: reduce) {
    .radar-ember {
        display: none;
    }

    .radar-data-inner {
        animation: none;
    }
}
</style>
