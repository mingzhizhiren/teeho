<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/icons/AppIcon.vue'
import AnalysisHistoryList from './AnalysisHistoryList.vue'
import type { AnalysisTask } from './analysis.contract'

const props = defineProps<{
    open: boolean
    tasks: AnalysisTask[]
    displayNames: ReadonlyMap<string, string>
    selectedTaskId: string | null
    loading: boolean
    error: string
    query: string
    returnFocus: HTMLButtonElement | null
}>()
const emit = defineEmits<{
    'update:open': [value: boolean]
    'update:query': [value: string]
    select: [task: AnalysisTask]
}>()
const { t } = useI18n()
const drawer = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
const titleId = 'analysis-history-drawer-title'
let bodyOverflow = ''

/** 关闭当前弹窗或抽屉 */
function close() {
    emit('update:open', false)
}

/** 选择并打开指定历史任务 */
function select(task: AnalysisTask) {
    emit('select', task)
    close()
}

/** 处理弹窗键盘关闭操作 */
function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
    }
    if (event.key !== 'Tab' || !drawer.value) {
        return
    }

    const focusableElements = Array.from(
        drawer.value.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
    )
    const firstElement = focusableElements[0]
    const lastElement = focusableElements[focusableElements.length - 1]
    if (!firstElement || !lastElement) {
        return
    }
    if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault()
        lastElement.focus()
    } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault()
        firstElement.focus()
    }
}

watch(
    () => props.open,
    async (open, wasOpen) => {
        if (open) {
            bodyOverflow = document.body.style.overflow
            document.body.style.overflow = 'hidden'
            await nextTick()
            closeButton.value?.focus()
        } else if (wasOpen) {
            document.body.style.overflow = bodyOverflow
            await nextTick()
            props.returnFocus?.focus()
        }
    },
    { flush: 'post' },
)

onBeforeUnmount(() => {
    if (props.open) {
        document.body.style.overflow = bodyOverflow
    }
})
</script>

<template>
    <Teleport to="body">
        <div
            v-if="open"
            class="fixed inset-0 z-50 flex justify-end bg-slate-950/55 lg:hidden"
            role="presentation"
            @click.self="close"
        >
            <aside
                ref="drawer"
                class="flex h-full w-[min(24rem,100vw)] flex-col border-l border-line bg-surface p-4 shadow-2xl"
                role="dialog"
                aria-modal="true"
                :aria-labelledby="titleId"
                data-testid="history-drawer"
                @keydown="handleKeydown"
            >
                <div class="flex items-start justify-between gap-4">
                    <div>
                        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
                            {{ t('workspace.history.eyebrow') }}
                        </p>
                        <h2 :id="titleId" class="mt-1 text-xl font-semibold text-ink">
                            {{ t('workspace.historyTitle') }}
                        </h2>
                    </div>
                    <button
                        ref="closeButton"
                        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line text-muted transition hover:border-brand/40 hover:bg-brand/5 hover:text-ink"
                        type="button"
                        :aria-label="t('workspace.history.close')"
                        @click="close"
                    >
                        <AppIcon name="close" />
                    </button>
                </div>

                <AnalysisHistoryList
                    class="mt-4"
                    :tasks="tasks"
                    :display-names="displayNames"
                    :selected-task-id="selectedTaskId"
                    :loading="loading"
                    :error="error"
                    :query="query"
                    @update:query="emit('update:query', $event)"
                    @select="select"
                />
            </aside>
        </div>
    </Teleport>
</template>
