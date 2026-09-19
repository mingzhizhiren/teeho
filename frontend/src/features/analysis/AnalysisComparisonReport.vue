<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { AnalysisResult } from './analysis.contract'
import { formatEngagementTier } from './analysis.engagement-display'
import { selectionReason } from './analysis.selection-reason'
import AnalysisStructureMetrics from './AnalysisStructureMetrics.vue'
defineProps<{ result: AnalysisResult }>()
const { t } = useI18n()
</script>

<template>
    <AnalysisStructureMetrics
        :metrics="result.structureMetrics"
        :references="result.structureReferences"
    />
    <section
        v-if="result.comparisonNotes.length"
        class="rounded-3xl border border-line bg-surface p-5 sm:p-6"
        data-testid="analysis-comparison-notes"
    >
        <h2 class="text-lg font-semibold text-ink">{{ t('workspace.checkup.comparisons') }}</h2>
        <ul class="mt-4 space-y-4">
            <li
                v-for="note in result.comparisonNotes"
                :id="`reference-${note.noteId}`"
                :key="note.noteId"
                class="scroll-mt-24 rounded-2xl border border-line p-4"
            >
                <a
                    v-if="note.url"
                    :href="note.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="break-words font-semibold text-brand underline underline-offset-4"
                >{{ note.title }}</a
                >
                <p v-else class="font-semibold text-ink">{{ note.title }}</p>
                <p v-if="!note.url" class="mt-1 text-xs text-muted">
                    {{ t('workspace.checkup.missingNoteUrl') }}
                </p>
                <p class="mt-2 whitespace-pre-line break-words text-sm leading-6 text-muted">
                    {{ note.bodyExcerpt }}
                </p>
                <div class="mt-3 flex flex-wrap items-center gap-4">
                    <dl class="flex flex-wrap gap-4 text-xs text-muted">
                        <div
                            v-for="metric in ['likes', 'collects', 'comments'] as const"
                            :key="metric"
                            class="flex gap-1"
                        >
                            <dt>{{ t(`workspace.checkup.${metric}`) }}</dt>
                            <dd>
                                {{
                                    formatEngagementTier(
                                        metric,
                                        note[metric],
                                        t('workspace.checkup.rapidGrowth'),
                                    )
                                }}
                            </dd>
                        </div>
                    </dl>
                    <span
                        class="inline-flex rounded-md border border-emerald-600/25 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300"
                        data-testid="comparison-selection-reason"
                        :aria-label="t('workspace.checkup.selectionReasonLabel')"
                    >
                        {{ t(`workspace.checkup.selectionReasons.${selectionReason(note)}`) }}
                    </span>
                </div>
            </li>
        </ul>
    </section>
</template>
