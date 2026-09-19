<template>
    <div class="mt-7 rounded-2xl border p-5" :class="statusCardClass" role="status">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
                <h2 class="font-semibold">
                    {{ statusTitle }}
                </h2>
                <p class="mt-2 text-sm leading-6 opacity-90">
                    {{ statusDescription }}
                </p>
                <p v-if="longRunning" class="mt-3 text-sm font-semibold">
                    {{ t('workspace.longRunning') }}
                </p>
                <p v-if="showUsualDuration && inProgress" class="mt-2 text-xs opacity-75">
                    {{
                        t('workspace.usualDuration', {
                            minutes: Math.ceil(task.expectedDurationSeconds / TIME_SECONDS.MINUTE),
                        })
                    }}
                </p>
            </div>
            <button
                v-if="canAbandon"
                class="shrink-0 rounded-xl border border-current px-4 py-2 text-sm font-semibold transition hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
                type="button"
                :disabled="busy"
                @click="emit('abandon')"
            >
                {{ t('workspace.abandonTask') }}
            </button>
            <button
                v-else-if="canRetry"
                class="shrink-0 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition hover:bg-brand-hover disabled:opacity-50"
                type="button"
                :disabled="busy"
                @click="emit('retry')"
            >
                {{ t('workspace.retryTask') }}
            </button>
        </div>

        <InlineFeedback
            v-if="actionError"
            class="mt-4"
            compact
            :feedback="{
                key: 'analysis.task.action',
                scope: 'module',
                tone: 'error',
                message: actionError,
                announce: 'assertive',
            }"
            dismiss-policy="after-interaction"
            @dismiss="emit('dismiss-error')"
        />
    </div>
</template>

<script setup lang="ts">
import { getFrontendRuntime } from '@/edition/runtime'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import InlineFeedback from '@/components/feedback/InlineFeedback.vue'
import { TIME_SECONDS } from '@/config/constants'
import { analysisUiConstraints } from './analysis.constants'
import type { AnalysisTask } from './analysis.contract'
import { canRetryAnalysisTaskStatus, isActiveAnalysisTaskStatus } from './analysis.task-status'
import { analysisTaskStatusTranslationKey } from './analysis.task-presentation'

const props = withDefaults(
    defineProps<{
        task: AnalysisTask
        busy: boolean
        clock: number
        showUsualDuration?: boolean
        actionError?: string
    }>(),
    {
        showUsualDuration: false,
        actionError: '',
    },
)
const emit = defineEmits<{
    abandon: []
    retry: []
    'dismiss-error': []
}>()
const { t } = useI18n()
const runtime = getFrontendRuntime()

const canAbandon = computed(() => isActiveAnalysisTaskStatus(props.task.status))
const canRetry = computed(
    () =>
        canRetryAnalysisTaskStatus(props.task.status) &&
        props.task.failure?.code !== 'no_reference_notes',
)
const inProgress = computed(() => isActiveAnalysisTaskStatus(props.task.status))
const longRunning = computed(
    () =>
        inProgress.value &&
        props.task.startedAt !== null &&
        props.clock - new Date(props.task.startedAt).getTime() >=
            analysisUiConstraints.longRunningTaskThresholdMs,
)
const statusCardClass = computed(() => {
    if (props.task.status === 'technical_failed' || props.task.status === 'insufficient_points') {
        return 'border-red-200 bg-red-50 text-red-800 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-100'
    }
    if (props.task.status === 'abandoned' || props.task.status === 'cancelled') {
        return 'border-line bg-surface-muted text-muted'
    }
    if (props.task.status === 'retrying') {
        return 'border-accent/30 bg-accent/10 text-accent'
    }
    return 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100'
})
const statusTranslationKey = computed(() => analysisTaskStatusTranslationKey(props.task))
const statusTitle = computed(() => t(`workspace.statusTitles.${statusTranslationKey.value}`))
const statusDescription = computed(() => {
    if (props.task.status === 'insufficient_points') {
        return (
            runtime.analysisText('taskBlocked', { task: props.task }) ||
            t('workspace.statusDescriptions.insufficient_points')
        )
    }
    if (props.task.status === 'technical_failed') {
        if (
            props.task.failure?.code === 'insight_unavailable' ||
            props.task.failure?.code === 'radar_unavailable' ||
            props.task.failure?.code === 'no_reference_notes'
        )
            return t(`workspace.checkup.failures.${props.task.failure.code}`)
        return props.task.failure?.message ?? t('workspace.genericError')
    }
    if (props.task.status === 'queued') {
        return t('workspace.queuePosition')
    }
    return t(`workspace.statusDescriptions.${statusTranslationKey.value}`)
})
</script>
