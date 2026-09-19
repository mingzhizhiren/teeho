<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { AnalysisResult } from './analysis.contract'
import { computed } from 'vue'
import { readPrimaryScore } from './analysis.primary-score'
const props = defineProps<{ result: AnalysisResult }>()
const primaryScore = computed(() => readPrimaryScore(props.result))
const MINIMUM_REFERENCE_SAMPLES = 20
const reference = computed(() => {
    const saved = props.result.insight?.reference
    return saved && saved.sampleCount >= MINIMUM_REFERENCE_SAMPLES ? saved : null
})
const { t } = useI18n()
const icons = { above: '🟩', near: '⬜', below: '🟥' } as const
</script>

<template>
    <section
        class="rounded-3xl border border-line bg-surface p-5 sm:p-6"
        data-testid="analysis-insight-score"
    >
        <h2 class="text-lg font-semibold text-ink">
            🎯
            {{
                t(
                    primaryScore.source === 'radar_average'
                        ? 'skillAuth.averageTitle'
                        : 'skillAuth.insightTitle',
                )
            }}
        </h2>
        <p data-testid="insight-score" class="mt-3 text-3xl font-semibold text-ink">
            {{ primaryScore.value.toFixed(2) }} / 10
            <span
                v-if="result.insight?.comparison"
                :aria-label="
                    t(`workspace.checkup.referenceComparison.${result.insight.comparison}`)
                "
            >
                {{ icons[result.insight.comparison] }}
            </span>
        </p>
        <dl v-if="primaryScore.source === 'insight'" class="mt-4 space-y-2 text-sm text-muted">
            <div class="flex flex-wrap gap-x-3">
                <dt>{{ t('workspace.checkup.referenceMedian') }}</dt>
                <dd>
                    {{
                        reference?.median.toFixed(2) ?? t('workspace.checkup.referenceUnavailable')
                    }}
                </dd>
            </div>
            <div class="flex flex-wrap gap-x-3">
                <dt>{{ t('workspace.checkup.referenceMax') }}</dt>
                <dd>
                    {{ reference?.max?.toFixed(2) ?? t('workspace.checkup.referenceUnavailable') }}
                </dd>
            </div>
            <div class="flex flex-wrap gap-x-3">
                <dt>{{ t('workspace.checkup.referenceMin') }}</dt>
                <dd>
                    {{ reference?.min?.toFixed(2) ?? t('workspace.checkup.referenceUnavailable') }}
                </dd>
            </div>
        </dl>
    </section>
</template>
