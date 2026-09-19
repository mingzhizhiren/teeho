<script setup lang="ts">
withDefaults(defineProps<{ size?: 'sm' | 'md' }>(), { size: 'sm' })
</script>

<template>
    <svg
        class="animate-spin"
        :class="size === 'md' ? 'h-5 w-5' : 'h-4 w-4'"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        data-app-spinner
    >
        <circle
            class="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            stroke-width="4"
        />
        <path
            class="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4Z"
        />
    </svg>
</template>
