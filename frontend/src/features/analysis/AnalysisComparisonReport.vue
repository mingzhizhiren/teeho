<script setup lang="ts">
import { computed } from 'vue'
import type { AnalysisResult } from './analysis.contract'
import AnalysisStructureMetrics from './AnalysisStructureMetrics.vue'
import AnalysisReferenceNotes from './AnalysisReferenceNotes.vue'
import { canShowReportSection } from './analysis.report-access'
const props = defineProps<{ result: AnalysisResult }>()
const emit = defineEmits<{ 'references-expanded': [] }>()
const notes = computed(() =>
    canShowReportSection(props.result.reportAccess, 'comparisonNotes')
        ? props.result.comparisonNotes.slice(
              0,
              props.result.reportAccess?.sections.comparisonNotes.limit,
          )
        : [],
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
    <AnalysisReferenceNotes :notes="notes" @expanded="emit('references-expanded')" />
</template>
