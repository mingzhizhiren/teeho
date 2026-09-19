<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import InlineFeedback from '@/components/feedback/InlineFeedback.vue'
import { formatDateTime } from '@/utils/format'
import type { AnalysisTask } from './analysis.contract'
import { analysisTaskStatusTranslationKey } from './analysis.task-presentation'
import { createLocalHistoryName } from './localHistory'

const props = defineProps<{
    tasks: AnalysisTask[]
    displayNames: ReadonlyMap<string, string>
    selectedTaskId: string | null
    loading: boolean
    error: string
    query: string
}>()
const emit = defineEmits<{
    'update:query': [value: string]
    select: [task: AnalysisTask]
}>()
const { locale, t } = useI18n()

/** 把搜索框内容同步给父级状态 */
function updateQuery(event: Event) {
    emit('update:query', (event.target as HTMLInputElement).value)
}

/** 解析历史任务的优先展示标题 */
function taskTitle(task: AnalysisTask) {
    return (
        props.displayNames.get(task.id) ||
        createLocalHistoryName(task) ||
        t('workspace.imageOnlyTask')
    )
}

/** 根据任务状态选择状态圆点样式 */
function statusDotClass(status: AnalysisTask['status']) {
    if (status === 'succeeded') {
        return 'bg-emerald-500'
    }
    if (status === 'technical_failed' || status === 'insufficient_points') {
        return 'bg-red-500'
    }
    if (status === 'abandoned' || status === 'cancelled') {
        return 'bg-slate-400'
    }
    if (status === 'researching' || status === 'processing' || status === 'retrying') {
        return 'bg-brand'
    }
    return 'bg-amber-500'
}

function taskStatusLabel(task: AnalysisTask) {
    return t(`workspace.statuses.${analysisTaskStatusTranslationKey(task)}`)
}

/** 按当前语言格式化日期时间 */
function formatDate(value: string) {
    return formatDateTime(value, locale.value)
}
</script>

<template>
    <div class="flex min-h-0 flex-1 flex-col">
        <p class="text-xs leading-5 text-muted">
            {{ t('workspace.localHistory.notice') }}
        </p>
        <input
            class="mt-3 w-full rounded-xl border border-line bg-surface-muted px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted focus:border-brand"
            type="search"
            :value="query"
            :placeholder="t('workspace.localHistory.searchPlaceholder')"
            :aria-label="t('workspace.localHistory.searchLabel')"
            @input="updateQuery"
        />
        <InlineFeedback
            v-if="error"
            class="mt-3"
            compact
            :feedback="{
                key: 'analysis.local-history.load',
                scope: 'module',
                tone: 'error',
                message: error,
            }"
        />

        <div class="mt-3 min-h-0 flex-1 overflow-y-auto">
            <p v-if="loading" class="px-2 py-6 text-xs leading-5 text-muted">
                {{ t('workspace.loadingLatest') }}
            </p>
            <button
                v-for="historyTask in tasks"
                v-else
                :key="historyTask.id"
                class="mb-2 w-full rounded-2xl border p-3 text-left transition"
                :class="
                    selectedTaskId === historyTask.id
                        ? 'border-accent/30 bg-accent/10'
                        : 'border-line bg-surface-muted hover:border-brand/30'
                "
                type="button"
                @click="emit('select', historyTask)"
            >
                <span class="flex items-start justify-between gap-2">
                    <span class="line-clamp-2 text-sm font-semibold leading-5 text-ink">
                        {{ taskTitle(historyTask) }}
                    </span>
                    <span
                        class="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                        :class="statusDotClass(historyTask.status)"
                    ></span>
                </span>
                <span class="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted">
                    <span>{{ formatDate(historyTask.createdAt) }}</span>
                    <span>{{ taskStatusLabel(historyTask) }}</span>
                </span>
            </button>
            <div
                v-if="!loading && tasks.length === 0"
                class="rounded-2xl border border-dashed border-line px-3 py-8 text-center text-xs leading-5 text-muted"
            >
                {{
                    query.trim()
                        ? t('workspace.localHistory.noSearchResults')
                        : t('workspace.historyEmpty')
                }}
            </div>
        </div>
    </div>
</template>
