<script setup lang="ts">
import { computed } from 'vue'

import { appIconPaths, type AppIconName, type AppIconSize } from './appIcon'

const props = withDefaults(
    defineProps<{
        name: AppIconName
        size?: AppIconSize
    }>(),
    {
        size: 'md',
    },
)

const sizeClass = computed(() => {
    if (props.size === 'sm') return 'h-4 w-4'
    if (props.size === 'lg') return 'h-6 w-6'
    return 'h-5 w-5'
})
</script>

<template>
    <svg
        :class="sizeClass"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        :data-app-icon="name"
    >
        <path v-for="path in appIconPaths[name]" :key="path" :d="path" />
    </svg>
</template>
