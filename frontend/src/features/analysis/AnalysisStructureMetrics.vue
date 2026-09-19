<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import {
    structureMetricNames,
    type StructureMetrics,
    type StructureReferences,
} from './analysis.structure-metrics'

interface Props {
    metrics: StructureMetrics
    references: StructureReferences
}

defineProps<Props>()
const { t, n } = useI18n()
const statusColors = {
    aligned: 'text-emerald-700 dark:text-emerald-300',
    minor: 'text-amber-800 dark:text-amber-300',
    moderate: 'text-orange-700 dark:text-orange-300',
    major: 'text-red-700 dark:text-red-300',
    critical: 'text-red-800 dark:text-red-400',
} as const

function formatValue(metric: keyof StructureMetrics, value: number | null): string {
    return value === null
        ? t('workspace.checkup.structureMetrics.unavailable')
        : n(value, {
              style: metric === 'titleEmojiRatio' ? 'percent' : 'decimal',
              maximumFractionDigits: 2,
          })
}
</script>

<template>
    <section
        class="rounded-3xl border border-line bg-surface p-5 sm:p-6"
        data-testid="analysis-structure-metrics"
    >
        <h2 class="text-lg font-semibold text-ink">
            {{ t('workspace.checkup.structureMetrics.title') }}
        </h2>
        <div
            class="mt-4 max-h-64 overflow-y-auto rounded-lg pr-3"
            role="region"
            :aria-label="t('workspace.checkup.structureMetrics.title')"
            tabindex="0"
        >
            <dl class="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
                <div
                    v-for="metric in structureMetricNames"
                    :key="metric"
                    class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1"
                >
                    <dt
                        class="flex flex-wrap items-center gap-2 break-words font-semibold text-ink"
                    >
                        <span
                            class="h-3 w-3 shrink-0 rounded-full bg-current"
                            :class="
                                metrics[metric] !== null && references[metric]
                                    ? statusColors[references[metric].severity]
                                    : 'text-muted/50'
                            "
                            aria-hidden="true"
                        />
                        <span>{{ t(`workspace.checkup.structureMetrics.fields.${metric}`) }}</span>
                    </dt>
                    <dd class="flex flex-wrap items-baseline gap-3">
                        <span
                            class="font-semibold tabular-nums"
                            :class="
                                metrics[metric] !== null && references[metric]
                                    ? statusColors[references[metric].severity]
                                    : 'text-muted'
                            "
                            :data-metric="metric"
                        >{{ formatValue(metric, metrics[metric]) }}</span>
                        <span
                            v-if="metrics[metric] === null || references[metric]"
                            class="text-sm font-medium"
                            :class="
                                metrics[metric] !== null && references[metric]
                                    ? statusColors[references[metric].severity]
                                    : 'text-muted'
                            "
                        >{{
                            metrics[metric] === null
                                ? t('workspace.checkup.structureMetrics.missingValue')
                                : references[metric]
                                    ? t(
                                        `workspace.checkup.structureMetrics.levels.${references[metric].severity}`,
                                    )
                                    : t('workspace.checkup.structureMetrics.insufficient')
                        }}</span
                        >
                    </dd>
                    <dd class="w-full text-sm leading-6 text-muted" :data-reference="metric">
                        {{
                            references[metric]
                                ? t('workspace.checkup.structureMetrics.range', {
                                    low: formatValue(metric, references[metric].low),
                                    high: formatValue(metric, references[metric].high),
                                })
                                : t('workspace.checkup.structureMetrics.insufficient')
                        }}
                    </dd>
                </div>
            </dl>
        </div>
    </section>
</template>
