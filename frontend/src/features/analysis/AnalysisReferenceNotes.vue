<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, nextTick, ref, useId } from 'vue'
import { presentReference } from './analysis.selection-reason'
import { formatReferenceTopics, normalizeReferenceTopics } from './analysis.reference-topics'
import AppConfirmDialog from '@/components/AppConfirmDialog.vue'
import { getComparisonNoteUrl, useComparisonNoteLink } from './useComparisonNoteLink'

interface ReferenceNoteDisplay {
    noteId: string
    title: string
    bodyExcerpt: string
    topics?: string[]
    url: string | null
    reason: string
    modelScore?: number | null
    likes: number | null
    collects: number | null
    comments: number | null
}
const props = withDefaults(
    defineProps<{ notes: readonly ReferenceNoteDisplay[]; initiallyExpanded?: boolean }>(),
    { initiallyExpanded: false },
)
const { t } = useI18n()
const emit = defineEmits<{ expanded: [] }>()
const comparisonsExpanded = ref(props.initiallyExpanded)
const referenceList = ref<HTMLUListElement | null>(null)
const highlightedNoteId = ref<string | null>(null)
function toggleComparisons(): void {
    comparisonsExpanded.value = !comparisonsExpanded.value
    if (comparisonsExpanded.value) emit('expanded')
}
/** 引用导航只展示本组件的目标笔记，不代表主动采用。 */
async function revealNote(id: string): Promise<void> {
    if (!props.notes.some((note) => note.noteId === id)) return
    comparisonsExpanded.value = true
    highlightedNoteId.value = null
    await nextTick()
    const target = Array.from(referenceList.value?.children ?? []).find(
        (element) => element.id === `reference-${id}`,
    )
    if (!target) return
    target.scrollIntoView({ block: 'nearest' })
    // 刷新移除动画后的样式，连续点击同一引用也从第一下重新播放。
    target.getBoundingClientRect()
    highlightedNoteId.value = id
}
defineExpose({ revealNote })
const comparisonsId = useId()
const { isNoticeOpen, requestOpen, confirmOpen, cancelOpen } = useComparisonNoteLink()
const referenceNotes = computed(() =>
    props.notes.map((note) => ({
        note,
        bodyParts: Array.from(normalizeReferenceTopics(note.bodyExcerpt).matchAll(/#[^\s#]+|[^#]+|#/gu), (match) => ({
            text: match[0],
            offset: match.index,
            isTopic: match[0].startsWith('#') && match[0].length > 1,
        })),
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
                @click="toggleComparisons"
            >
                {{ t('workspace.checkup.comparisons') }}
                <span aria-hidden="true">{{ comparisonsExpanded ? '−' : '+' }}</span>
            </button>
        </h2>
        <ul
            v-show="comparisonsExpanded"
            :id="comparisonsId"
            ref="referenceList"
            class="space-y-4 border-t border-line p-5"
        >
            <li
                v-for="{ note, bodyParts, url, presentation } in referenceNotes"
                :id="`reference-${note.noteId}`"
                :key="note.noteId"
                class="scroll-mt-24 rounded-2xl border border-line p-4"
                :class="{ 'reference-note-highlight': highlightedNoteId === note.noteId }"
                @animationend.self="highlightedNoteId === note.noteId && (highlightedNoteId = null)"
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
                    <span
                        v-for="part in bodyParts"
                        :key="part.offset"
                        :class="{ 'text-accent': part.isTopic }"
                    >{{ part.text }}</span>
                </p>
                <p v-if="note.topics?.length" class="mt-2 break-words text-sm text-accent">
                    {{ formatReferenceTopics(note.topics) }}
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

<style scoped>
.reference-note-highlight {
    animation: reference-note-flash 700ms ease-in-out 2;
}

@keyframes reference-note-flash {
    0%, 100% {
        border-color: rgb(var(--color-border));
        box-shadow: 0 0 0 4px rgb(var(--color-brand) / 0);
    }
    25%, 65% {
        border-color: rgb(var(--color-brand));
        box-shadow: 0 0 0 4px rgb(var(--color-brand) / 0.3);
    }
}

@media (prefers-reduced-motion: reduce) {
    .reference-note-highlight {
        animation: reference-note-static 1400ms linear;
        /* 全局减少动效规则压缩动画时长；此处只保留无闪烁的定位提示。 */
        animation-duration: 1400ms !important;
    }

    @keyframes reference-note-static {
        from, to {
            border-color: rgb(var(--color-brand));
            box-shadow: 0 0 0 4px rgb(var(--color-brand) / 0.3);
        }
    }
}
</style>
