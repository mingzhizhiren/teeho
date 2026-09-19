<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/icons/AppIcon.vue'
import type { AnalysisResult } from './analysis.contract'

const props = defineProps<{ result: AnalysisResult }>()
const { t } = useI18n()
const analysis = computed(() => props.result.contentAnalysis)
const MAXIMUM_STARS = 5
const starPositions = Array.from({ length: MAXIMUM_STARS }, (_, index) => index + 1)
</script>

<template>
    <section
        class="rounded-3xl border border-line bg-surface p-5 sm:p-6"
        data-testid="analysis-content-analysis"
    >
        <h2 class="flex items-center gap-2 text-lg font-semibold text-ink">
            <AppIcon name="robot" />
            {{ t('workspace.checkup.contentAnalysis.title') }}
        </h2>
        <template v-if="analysis">
            <div class="mt-5">
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <h3 class="text-sm font-semibold text-ink">
                        {{ t('workspace.checkup.contentAnalysis.consistency') }}
                    </h3>
                    <div class="flex items-center gap-2" data-testid="analysis-consistency-stars">
                        <span class="flex gap-1" aria-hidden="true">
                            <AppIcon
                                v-for="position in starPositions"
                                :key="position"
                                name="star"
                                size="sm"
                                :class="
                                    position <= analysis.consistency.stars
                                        ? 'fill-current text-brand'
                                        : 'text-muted'
                                "
                            />
                        </span>
                        <span class="text-sm font-semibold text-ink">{{
                            t('workspace.checkup.contentAnalysis.stars', {
                                count: analysis.consistency.stars,
                            })
                        }}</span>
                    </div>
                </div>
                <p
                    v-if="analysis.status === 'fallback'"
                    class="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100"
                    data-testid="analysis-content-fallback"
                >
                    {{ t('workspace.checkup.contentAnalysis.fallback') }}
                </p>
                <p class="mt-3 whitespace-pre-line break-words text-sm leading-6 text-ink">
                    {{ analysis.consistency.summary }}
                </p>
                <p
                    v-if="analysis.status === 'completed' && analysis.consistency.stars === 0"
                    class="mt-3 text-sm font-semibold text-red-700 dark:text-red-200"
                    data-testid="analysis-score-blocked"
                >
                    {{ t('workspace.checkup.contentAnalysis.scoreBlocked') }}
                </p>
                <ul v-if="analysis.consistency.issues.length" class="mt-4 space-y-3">
                    <li
                        v-for="issue in analysis.consistency.issues"
                        :key="`${issue.location}:${issue.evidence}:${issue.description}`"
                        class="rounded-xl bg-surface-muted p-3 text-sm leading-6"
                    >
                        <p class="text-xs font-semibold text-muted">
                            {{ t(`workspace.checkup.contentAnalysis.locations.${issue.location}`) }}
                        </p>
                        <blockquote
                            class="mt-1 whitespace-pre-line break-words border-l-2 border-brand/40 pl-3 text-ink"
                        >
                            {{ issue.evidence }}
                        </blockquote>
                        <p class="mt-2 whitespace-pre-line break-words text-ink">
                            {{ issue.description }}
                        </p>
                    </li>
                </ul>
            </div>
            <template v-if="analysis.status === 'completed'">
                <div
                    class="mt-5 border-t border-line pt-5"
                    data-testid="analysis-reference-weaknesses"
                >
                    <h3 class="text-sm font-semibold text-ink">
                        {{ t('workspace.checkup.contentAnalysis.weaknesses') }}
                    </h3>
                    <ul v-if="analysis.weaknesses.length" class="mt-3 space-y-3">
                        <li
                            v-for="weakness in analysis.weaknesses"
                            :key="`${weakness.location}:${weakness.evidence}:${weakness.description}`"
                            class="rounded-xl bg-surface-muted p-3 text-sm leading-6"
                        >
                            <p class="text-xs font-semibold text-muted">
                                {{
                                    t(
                                        `workspace.checkup.contentAnalysis.locations.${weakness.location}`,
                                    )
                                }}
                            </p>
                            <blockquote
                                class="mt-1 whitespace-pre-line break-words border-l-2 border-brand/40 pl-3 text-ink"
                            >
                                {{ weakness.evidence }}
                            </blockquote>
                            <p class="mt-2 whitespace-pre-line break-words text-ink">
                                {{ weakness.description }}
                            </p>
                            <p class="mt-2 text-xs text-muted">
                                {{ t('workspace.checkup.contentAnalysis.references') }}
                            </p>
                            <ul class="mt-1 space-y-1">
                                <li
                                    v-for="note in result.comparisonNotes.filter((item) =>
                                        weakness.referenceIds.includes(item.noteId),
                                    )"
                                    :key="note.noteId"
                                >
                                    <a
                                        v-if="note.url"
                                        :href="note.url"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        class="break-words text-brand underline underline-offset-4"
                                    >{{ note.title }}</a
                                    >
                                    <span v-else class="break-words text-ink">{{
                                        note.title
                                    }}</span>
                                </li>
                            </ul>
                        </li>
                    </ul>
                    <p v-else class="mt-2 text-sm leading-6 text-muted">
                        {{ t('workspace.checkup.contentAnalysis.noWeaknesses') }}
                    </p>
                </div>
            </template>
        </template>
        <p v-else class="mt-4 whitespace-pre-line break-words text-sm leading-6 text-ink">
            {{ result.qualitativeConclusion.summary }}
        </p>
        <slot name="footer" />
    </section>
</template>
