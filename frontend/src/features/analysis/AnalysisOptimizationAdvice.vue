<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
    createContentAdviceLabels,
    formatAdviceLocation,
    orderedAdviceItems,
    type ContentAdvice,
} from './analysis.advice'

const props = defineProps<{ advice: ContentAdvice }>()
const { t } = useI18n()
const labels = computed(() => createContentAdviceLabels((key, values) => t(key, values ?? {})))
const items = computed(() => orderedAdviceItems(props.advice))
</script>

<template>
    <section
        class="mt-5 border-t border-line pt-5"
        :aria-label="labels.title"
        data-testid="analysis-optimization-advice"
    >
        <h3 class="text-sm font-semibold text-ink">{{ labels.title }}</h3>
        <p v-if="advice.status === 'unavailable'" class="mt-2 text-sm leading-6 text-muted">
            {{ labels.unavailable }}
        </p>
        <p v-else-if="!items.length" class="mt-2 text-sm leading-6 text-muted">
            {{ labels.empty }}
        </p>
        <ol v-else class="mt-3 space-y-3">
            <li
                v-for="item in items"
                :key="`${item.sourceId}:${item.problem}:${item.evidence}`"
                class="rounded-xl bg-surface-muted p-3 text-sm leading-6"
            >
                <div class="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted">
                    <span
                        class="rounded-full border border-line bg-surface px-2 py-0.5 font-semibold text-ink"
                    >{{ labels.priorities[item.priority] }}</span
                    >
                    <span class="min-w-0 break-words"
                    >{{ labels.location }}：{{ formatAdviceLocation(item, labels) }}</span
                    >
                </div>
                <h4 class="mt-2 whitespace-pre-line break-words font-semibold text-ink">
                    {{ item.problem }}
                </h4>
                <p class="mt-2 text-xs font-semibold text-muted">{{ labels.evidence }}</p>
                <blockquote
                    class="mt-1 whitespace-pre-line break-words border-l-2 border-brand/40 pl-3 text-ink"
                >
                    {{ item.evidence }}
                </blockquote>
                <p class="mt-3 text-xs font-semibold text-muted">{{ labels.suggestion }}</p>
                <p class="mt-1 whitespace-pre-line break-words text-ink">{{ item.suggestion }}</p>
            </li>
        </ol>
    </section>
</template>
