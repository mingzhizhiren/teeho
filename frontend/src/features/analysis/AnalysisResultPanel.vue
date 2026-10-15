<script setup lang="ts">
import ArtNote from '@/components/art/ArtNote.vue'
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
    canEdit: boolean
    busy: boolean
    clock: number
    actionError: string
    viewContext: 'current' | 'history'
    historyRecord: LocalHistoryRecord | null
    loadOriginalImage: LocalHistoryImageLoader
}>()

const emit = defineEmits<{
    edit: []
    'dismiss-error': []
}>()
</script>

<template>
    <div class="art-workspace-note mb-5">
        <ArtNote message="report" />
    </div>
    <AnalysisResultCard
        :task="task"
        :result-fields="resultFields"
        :tracks="tracks"
        :can-edit="canEdit"
        :edit-busy="busy"
        :clock="clock"
        :action-error="actionError"
        :view-context="viewContext"
        :history-record="historyRecord"
        :load-original-image="loadOriginalImage"
        @edit="emit('edit')"
        @dismiss-error="emit('dismiss-error')"
    />
</template>
