<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/icons/AppIcon.vue'
import ToastMessage from '@/components/ToastMessage.vue'
import InlineFeedback from '@/components/feedback/InlineFeedback.vue'
import type { AnalysisTask } from './analysis.contract'

const props = defineProps<{ task: AnalysisTask }>()
const { t } = useI18n()
const isCopying = ref(false)
const isCopied = ref(false)
const hasCopyError = ref(false)
const COPY_NOTICE_MS = 2000
let noticeTimer: ReturnType<typeof setTimeout> | undefined
let isDisposed = false
const noteText = computed(() => {
    const { title, body, topics } = props.task.standardTask.fields
    const hashtags = topics.value
        .map((topic) => topic.replace(/^[#＃\s]+/u, '').trim())
        .filter(Boolean)
        .map((topic) => `#${topic}`)
        .join(' ')
    return [title.value, body.value, hashtags].filter(Boolean).join('\n\n')
})

async function copyNote(): Promise<void> {
    if (isCopying.value) return
    isCopying.value = true
    hasCopyError.value = false
    isCopied.value = false
    clearTimeout(noticeTimer)
    try {
        await navigator.clipboard.writeText(noteText.value)
        if (isDisposed) return
        isCopied.value = true
        noticeTimer = setTimeout(() => (isCopied.value = false), COPY_NOTICE_MS)
    } catch {
        if (!isDisposed) hasCopyError.value = true
    } finally {
        isCopying.value = false
    }
}

onBeforeUnmount(() => {
    isDisposed = true
    clearTimeout(noticeTimer)
})
</script>

<template>
    <div class="flex flex-col items-end gap-2">
        <button
            type="button"
            class="inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink transition hover:border-brand/50 hover:bg-brand/5 disabled:opacity-50"
            :disabled="isCopying"
            @click="copyNote"
        >
            <AppIcon name="copy" size="sm" />
            {{ isCopying ? t('workspace.copy.copying') : t('workspace.copy.note') }}
        </button>
        <InlineFeedback
            v-if="hasCopyError"
            compact
            :feedback="{
                key: 'analysis.note.copy',
                scope: 'item',
                tone: 'error',
                message: t('workspace.copy.failure'),
                announce: 'assertive',
            }"
        />
        <ToastMessage :visible="isCopied" :message="t('workspace.copy.noteSuccess')" />
    </div>
</template>
