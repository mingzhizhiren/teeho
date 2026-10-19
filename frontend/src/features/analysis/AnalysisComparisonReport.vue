<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, ref, useId } from 'vue'
import type { AnalysisResult } from './analysis.contract'
import { presentReference } from './analysis.selection-reason'
import AnalysisStructureMetrics from './AnalysisStructureMetrics.vue'
import { canShowReportSection } from './analysis.report-access'
import AppConfirmDialog from '@/components/AppConfirmDialog.vue'
import { getComparisonNoteUrl, useComparisonNoteLink } from './useComparisonNoteLink'
const props = defineProps<{ result: AnalysisResult }>()
const { t } = useI18n()
const comparisonsExpanded = ref(false)
const comparisonsId = useId()
const { isNoticeOpen, requestOpen, confirmOpen, cancelOpen } = useComparisonNoteLink()
const referenceNotes = computed(() =>
    (canShowReportSection(props.result.reportAccess, 'comparisonNotes')
        ? props.result.comparisonNotes.slice(
              0,
              props.result.reportAccess?.sections.comparisonNotes.limit,
          )
        : []
    ).map((note) => ({
        note,
        url: getComparisonNoteUrl(note.url),
        presentation: presentReference(note, {
            semanticReference: t('workspace.checkup.semanticReference'),
            selectionReasons: {
                high_exposure: t('workspace.checkup.selectionReasons.high_exposure'),
                rapid_growth: t('workspace.checkup.selectionReasons.rapid_growth'),
            },
            rapidGrowth: t('workspace.checkup.rapidGrowth'),
        }),
    })),
)
</script>

<template>
    <AnalysisStructureMetrics
        v-if="canShowReportSection(result.reportAccess, 'structureMetrics')"
        :metrics="result.structureMetrics"
        :references="result.structureReferences"
        :locations="result.structureLocations"
        :report-access="result.reportAccess"
    />
    <section
        v-if="referenceNotes.length"
        class="rounded-2xl border border-line bg-surface"
        data-testid="analysis-comparison-notes"
    >
        <h2>
            <button
                class="flex min-h-12 w-full items-center justify-between gap-3 px-5 py-3 text-left text-sm font-semibold text-ink"
                type="button"
                :aria-expanded="comparisonsExpanded"
                :aria-controls="comparisonsId"
                @click="comparisonsExpanded = !comparisonsExpanded"
            >
                {{ t('workspace.checkup.comparisons') }}
                <span aria-hidden="true">{{ comparisonsExpanded ? '−' : '+' }}</span>
            </button>
        </h2>
        <ul
            v-show="comparisonsExpanded"
            :id="comparisonsId"
            class="space-y-4 border-t border-line p-5"
        >
            <li
                v-for="{ note, url, presentation } in referenceNotes"
                :id="`reference-${note.noteId}`"
                :key="note.noteId"
                class="scroll-mt-24 rounded-2xl border border-line p-4"
            >
                <a
                    v-if="url"
                    :href="url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="break-words font-semibold text-brand underline underline-offset-4"
                    @click="requestOpen($event, url)"
                    @auxclick="requestOpen($event, url)"
                >{{ note.title }}</a
                >
                <p v-else class="font-semibold text-ink">{{ note.title }}</p>
                <p
                    v-if="note.modelScore != null"
                    class="mt-1 text-sm font-semibold text-ink"
                    data-testid="reference-model-score"
                >
                    {{ t('workspace.checkup.referenceModelScore') }} ·
                    {{ note.modelScore.toFixed(2) }} / 10
                </p>
                <p v-if="!url" class="mt-1 text-xs text-muted">
                    {{ t('workspace.checkup.missingNoteUrl') }}
                </p>
                <p
                    v-if="note.bodyExcerpt"
                    class="mt-2 whitespace-pre-line break-words text-sm leading-6 text-muted"
                >
                    {{ note.bodyExcerpt }}
                </p>
                <p v-if="note.topics?.length" class="mt-2 break-words text-sm text-muted">
                    {{ note.topics.map((topic) => `#${topic}`).join(' ') }}
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
                                {{ presentation.counts[metric] }}
                            </dd>
                        </div>
                    </dl>
                    <span
                        class="inline-flex rounded-md border border-emerald-600/25 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300"
                        data-testid="comparison-selection-reason"
                        :aria-label="t('workspace.checkup.selectionReasonLabel')"
                    >
                        {{ presentation.reason }}
                    </span>
                </div>
            </li>
        </ul>
    </section>
    <AppConfirmDialog
        v-model:open="isNoticeOpen"
        :title="t('workspace.checkup.noteScanNotice.title')"
        :description="t('workspace.checkup.noteScanNotice.description')"
        :confirm-label="t('workspace.checkup.noteScanNotice.confirm')"
        :cancel-label="t('workspace.checkup.noteScanNotice.cancel')"
        @confirm="confirmOpen"
        @cancel="cancelOpen"
    >
        <template #illustration>
            <img
                src="/images/art/mascot-scan-notice.webp"
                alt=""
                width="128"
                height="128"
                class="mx-auto h-28 w-28 object-contain sm:h-32 sm:w-32"
            />
        </template>
    </AppConfirmDialog>
</template>
