<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import type { AppIconName } from '@/components/icons/appIcon'

const props = defineProps<{ name?: string }>()
const documentIconNames = new Set<AppIconName>(['file-text', 'shield', 'receipt-refund'])

const resolvedName = computed<AppIconName>(() => {
    const name = props.name
    return name && documentIconNames.has(name as AppIconName) ? (name as AppIconName) : 'diamond'
})
</script>

<template>
    <AppIcon
        :name="resolvedName"
        size="lg"
        :data-document-icon="resolvedName"
    />
</template>
