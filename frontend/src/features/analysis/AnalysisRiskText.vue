<script setup lang="ts">
import { computed } from 'vue'
import { riskTextSegments } from './analysis.risk-matches'
const props = defineProps<{ text: string; terms: readonly string[] }>()
const segments = computed(() => riskTextSegments(props.text, props.terms))
</script>

<template>
    <span class="whitespace-pre-wrap break-words"
    ><span
        v-for="segment in segments"
        :key="segment.start"
        :class="
            segment.matched
                ? 'underline decoration-red-500 decoration-solid decoration-2 underline-offset-4'
                : undefined
        "
        :data-risk-match="segment.matched ? '' : undefined"
    >{{ segment.text }}</span
    ></span
    >
</template>
