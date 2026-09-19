<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'

import type { ProductGuideModule } from './productGuide.types'

const props = defineProps<{
    accountId: string | null
    module: ProductGuideModule
}>()

watch(
    () => props.accountId,
    (_accountId, previousAccountId) => {
        if (previousAccountId !== undefined && previousAccountId !== props.accountId) {
            props.module.destroy()
        }
    },
)

onBeforeUnmount(() => props.module.destroy())
</script>

<template>
    <div data-product-guide-host aria-hidden="true" />
</template>
