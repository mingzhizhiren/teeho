<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'

import type { OnboardingCoordinatorRuntime } from './onboarding.types'

const props = defineProps<{
    accountId: string | null
    runtime: OnboardingCoordinatorRuntime
}>()

function refreshEnvironment(): void {
    props.runtime.refreshEnvironment()
}

watch(() => props.accountId, refreshEnvironment)

onMounted(() => {
    document.addEventListener('visibilitychange', refreshEnvironment)
    window.addEventListener('focus', refreshEnvironment)
    window.addEventListener('blur', refreshEnvironment)
    refreshEnvironment()
})

onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', refreshEnvironment)
    window.removeEventListener('focus', refreshEnvironment)
    window.removeEventListener('blur', refreshEnvironment)
    props.runtime.destroy()
})
</script>

<template>
    <div data-onboarding-coordinator-host aria-hidden="true" />
</template>
