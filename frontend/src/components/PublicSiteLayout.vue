<template>
    <div class="flex min-h-screen flex-col overflow-x-clip bg-canvas text-ink">
        <PublicSiteHeader />
        <div class="flex min-h-0 flex-1 flex-col">
            <slot />
        </div>
        <PublicSiteFooter />
    </div>
</template>

<script setup lang="ts">
import PublicSiteFooter from '@/components/PublicSiteFooter.vue'
import PublicSiteHeader from '@/components/PublicSiteHeader.vue'
</script>
