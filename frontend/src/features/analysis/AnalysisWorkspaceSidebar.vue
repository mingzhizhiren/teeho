<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/icons/AppIcon.vue'
import AnalysisHistoryList from './AnalysisHistoryList.vue'
import type { AnalysisInputMode, AnalysisTask } from './analysis.contract'

defineProps<{
    mode: AnalysisInputMode
    tasks: AnalysisTask[]
    displayNames: ReadonlyMap<string, string>
    selectedTaskId: string | null
    loading: boolean
    error: string
    query: string
    draftSessionHasContent: boolean
    draftSessionLocked?: boolean
}>()
const emit = defineEmits<{
    compose: []
    'clear-draft': []
    select: [task: AnalysisTask]
    'update:query': [value: string]
}>()
const { t } = useI18n()
</script>

<template>
    <aside
        class="flex flex-col rounded-3xl border border-line bg-surface p-4 shadow-sm lg:min-h-0 lg:overflow-y-auto"
    >
        <div class="w-full">
            <p class="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand">
                {{ t('workspace.navigationTitle') }}
            </p>
            <nav
                class="mt-3 flex items-stretch gap-2"
                :aria-label="t('workspace.featureNavigationLabel')"
            >
                <button
                    class="group flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-brand/20 bg-brand/5 px-3 py-3 text-left text-ink transition hover:border-brand/40 hover:bg-brand/10"
                    type="button"
                    :aria-current="selectedTaskId === null ? 'page' : undefined"
                    @click="emit('compose')"
                >
                    <span
                        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand"
                        aria-hidden="true"
                    >
                        <AppIcon name="workspace" />
                    </span>
                    <span class="min-w-0">
                        <span class="block text-sm font-semibold">
                            {{ t('workspace.analysisFeature') }}
                        </span>
                        <span class="mt-0.5 block truncate text-xs text-muted">
                            {{ t(`workspace.modeLabels.${mode}`) }}
                        </span>
                    </span>
                </button>
                <button
                    v-if="draftSessionHasContent"
                    class="shrink-0 rounded-2xl border border-line bg-surface-muted px-3 text-xs font-semibold text-muted transition hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:hover:border-red-400/30 dark:hover:bg-red-400/10 dark:hover:text-red-300"
                    type="button"
                    data-testid="clear-analysis-conversation"
                    :disabled="draftSessionLocked"
                    :aria-label="t('workspace.agentChat.clear')"
                    @click="emit('clear-draft')"
                >
                    {{ t('workspace.agentChat.clear') }}
                </button>
            </nav>
        </div>

        <div class="mx-3 my-5 hidden border-t border-line lg:block"></div>

        <div class="hidden min-h-0 flex-1 lg:flex lg:flex-col">
            <div class="flex items-center justify-between px-2">
                <p class="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
                    {{ t('workspace.historyTitle') }}
                </p>
                <span
                    v-if="tasks.length"
                    class="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-muted"
                >
                    {{ tasks.length }}
                </span>
            </div>

            <AnalysisHistoryList
                class="mt-3 px-2"
                :tasks="tasks"
                :display-names="displayNames"
                :selected-task-id="selectedTaskId"
                :loading="loading"
                :error="error"
                :query="query"
                @update:query="emit('update:query', $event)"
                @select="emit('select', $event)"
            />
        </div>
    </aside>
</template>
