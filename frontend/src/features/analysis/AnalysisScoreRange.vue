<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { scoreRangePosition, type ScoreRangeReference } from './analysis.score-range'

const props = defineProps<{ score: number; reference: ScoreRangeReference | null }>()
const { t } = useI18n()
const range = computed(() => scoreRangePosition(props.score, props.reference))
const percent = computed(() => range.value?.percent.toFixed(1))
</script>

<template>
    <div v-if="range && range.boundary !== 'below'" class="score-range mt-6" data-testid="score-range">
        <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span class="text-sm font-medium text-ink">{{
                t('workspace.checkup.scoreRange.title')
            }}</span>
            <span class="score-range-percent text-2xl font-semibold tabular-nums text-ink">
                {{ percent }}<span class="ml-0.5 text-sm text-muted">%</span>
            </span>
        </div>
        <div
            class="score-range-chart"
            role="meter"
            :aria-label="t('workspace.checkup.scoreRange.title')"
            :aria-valuemin="0"
            :aria-valuemax="100"
            :aria-valuenow="range.percent"
            :aria-valuetext="
                t('workspace.checkup.scoreRange.accessible', {
                    score: score.toFixed(2),
                    percent,
                    min: range.minimum.toFixed(2),
                    max: range.maximum.toFixed(2),
                    median: range.median.toFixed(2),
                })
            "
        >
            <div
                class="score-range-endpoints mb-3 flex justify-between gap-4 text-xs text-muted"
                aria-hidden="true"
            >
                <span data-testid="score-range-minimum">
                    {{ t('workspace.checkup.scoreRange.minimum') }}
                    <b class="font-medium tabular-nums text-ink">{{ range.minimum.toFixed(2) }}</b>
                </span>
                <span class="text-right" data-testid="score-range-maximum">
                    {{ t('workspace.checkup.scoreRange.maximum') }}
                    <b class="font-medium tabular-nums text-ink">{{ range.maximum.toFixed(2) }}</b>
                </span>
            </div>
            <div class="score-range-rail" aria-hidden="true">
                <div class="score-range-fill" :style="{ width: `${range.percent}%` }" />
                <div class="score-range-ticks" />
                <span
                    class="score-range-median"
                    :style="{ left: `${range.medianPercent}%` }"
                    data-testid="score-range-median"
                />
                <span
                    class="score-range-pointer"
                    :style="{ left: `${range.percent}%` }"
                    data-testid="score-range-pointer"
                />
            </div>
            <div class="score-range-legend text-xs text-muted" aria-hidden="true">
                <span
                ><i class="score-range-key-current" />{{
                    t('workspace.checkup.scoreRange.current')
                }}
                    <b class="text-ink">{{ score.toFixed(2) }}</b></span
                >
                <span
                ><i class="score-range-key-median" />{{
                    t('workspace.checkup.scoreRange.median')
                }}
                    <b class="text-ink">{{ range.median.toFixed(2) }}</b></span
                >
            </div>
        </div>
        <p v-if="range.boundary !== 'within'" class="mt-2 text-xs text-muted">
            {{ t(`workspace.checkup.scoreRange.${range.boundary}`) }}
        </p>
    </div>
</template>

<style scoped>
.score-range {
    max-width: 46rem;
}
.score-range-chart {
    margin-top: 1.75rem;
}
.score-range-endpoints {
    margin-inline: 0.9rem;
}
.score-range-rail {
    position: relative;
    height: 0.75rem;
    margin-inline: 0.9rem;
    border-radius: 999px;
    background: rgb(var(--color-border) / 0.65);
    box-shadow: inset 0 1px 3px rgb(var(--color-text) / 0.12);
}
.score-range-fill {
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(
        90deg,
        rgb(var(--color-brand-glow)),
        rgb(var(--color-brand-vivid)),
        rgb(var(--color-brand-hot))
    );
    box-shadow:
        0 3px 14px rgb(var(--color-brand) / 0.18),
        inset 0 1px 0 rgb(var(--color-surface) / 0.5);
}
.score-range-ticks {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: repeating-linear-gradient(
        90deg,
        transparent 0,
        transparent calc(10% - 1px),
        rgb(var(--color-surface) / 0.65) calc(10% - 1px),
        rgb(var(--color-surface) / 0.65) 10%
    );
}
.score-range-median {
    position: absolute;
    top: -0.5rem;
    height: 1.75rem;
    border-left: 2px dashed rgb(var(--color-text) / 0.65);
    transform: translateX(-50%);
}
.score-range-pointer {
    position: absolute;
    z-index: 1;
    top: -0.25rem;
    width: 1.25rem;
    height: 1.25rem;
    border: 3px solid rgb(var(--color-surface));
    border-radius: 0.25rem;
    background: rgb(var(--color-brand));
    box-shadow:
        0 0 0 1px rgb(var(--color-brand) / 0.55),
        0 3px 10px rgb(var(--color-brand) / 0.3);
    transform: translateX(-50%) rotate(45deg);
}
.score-range-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1.25rem;
    margin-top: 1.25rem;
}
.score-range-legend > span {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
}
.score-range-key-current {
    width: 0.5rem;
    height: 0.5rem;
    background: rgb(var(--color-brand));
    transform: rotate(45deg);
}
.score-range-key-median {
    height: 0.8rem;
    border-left: 2px dashed rgb(var(--color-text) / 0.65);
}
@media (prefers-reduced-motion: no-preference) {
    .score-range {
        animation: score-range-reveal 400ms ease-out both;
    }
    @keyframes score-range-reveal {
        from {
            opacity: 0;
            transform: translateY(4px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
}
</style>
