<script setup lang="ts">
import { getFrontendRuntime } from '@/edition/runtime'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppConfirmDialog from '@/components/AppConfirmDialog.vue'
import { useOnboardingBlocker } from '@/features/onboarding/useOnboardingBlocker'
import AnalysisResultCard from './AnalysisResultCard.vue'
import type {
    AnalysisTask,
    AnalysisTrackDefinition,
    TaskFieldDefinition,
} from './analysis.contract'
import type { LocalHistoryImageLoader, LocalHistoryRecord } from './localHistory'

defineProps<{
    task: AnalysisTask
    resultFields: TaskFieldDefinition[]
    tracks: AnalysisTrackDefinition[]
    canReanalyze: boolean
    busy: boolean
    clock: number
    actionError: string
    viewContext: 'current' | 'history'
    historyRecord: LocalHistoryRecord | null
    loadOriginalImage: LocalHistoryImageLoader
}>()

const emit = defineEmits<{
    reanalyze: []
    'dismiss-error': []
}>()

const { t } = useI18n()
const runtime = getFrontendRuntime()
const reanalysisConfirmOpen = ref(false)
useOnboardingBlocker(
    computed(() => reanalysisConfirmOpen.value),
    'business_dialog',
)

function confirmReanalysis() {
    reanalysisConfirmOpen.value = false
    emit('reanalyze')
}
</script>

<template>
    <AnalysisResultCard
        :task="task"
        :result-fields="resultFields"
        :tracks="tracks"
        :can-reanalyze="canReanalyze"
        :reanalysis-busy="busy"
        :clock="clock"
        :action-error="actionError"
        :view-context="viewContext"
        :history-record="historyRecord"
        :load-original-image="loadOriginalImage"
        @reanalyze="reanalysisConfirmOpen = true"
        @dismiss-error="emit('dismiss-error')"
    />

    <AppConfirmDialog
        v-model:open="reanalysisConfirmOpen"
        :title="t('workspace.versions.reanalyzeConfirmTitle')"
        :description="
            runtime.analysisText('reanalyzeDescription', { task }) ||
                t('workspace.versions.reanalyzeConfirmDescription')
        "
        :confirm-label="
            runtime.analysisText('reanalyzeConfirm', { task }) ||
                t('workspace.versions.reanalyzeConfirmAction')
        "
        :cancel-label="t('common.cancel')"
        :notice="t('workspace.versions.retentionNotice')"
        :busy="busy"
        tone="danger"
        @confirm="confirmReanalysis"
    />
</template>
