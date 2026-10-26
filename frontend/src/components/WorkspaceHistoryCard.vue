<script setup lang="ts">
defineProps<{
    title: string
    date: string
    status: string
    dotClass: string
    selected: boolean
    disabled?: boolean
}>()
const emit = defineEmits<{ select: [] }>()
</script>

<template>
    <button
        class="mb-2 w-full rounded-2xl border p-3 text-left transition"
        :class="
            selected
                ? 'border-accent/30 bg-accent/10'
                : 'border-line bg-surface-muted hover:border-brand/30'
        "
        type="button"
        :disabled="disabled"
        :aria-current="selected ? 'true' : undefined"
        @click="emit('select')"
    >
        <span class="flex items-start justify-between gap-2">
            <span class="line-clamp-2 text-sm font-semibold leading-5 text-ink">{{ title }}</span>
            <span
                class="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                :class="dotClass"
                aria-hidden="true"
            ></span>
        </span>
        <span class="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted">
            <span>{{ date }}</span>
            <span>{{ status }}</span>
        </span>
    </button>
</template>
