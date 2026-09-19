<script setup lang="ts">
import DocumentView from '@/features/documents/DocumentView.vue'
import type {
    PublicDocumentCategory,
    PublicDocumentSlug,
} from '@/features/documents/document.adapter'

defineProps<{
    category: PublicDocumentCategory
    slug: PublicDocumentSlug
    defaultTitleKey: string
}>()
</script>

<template>
    <DocumentView :category="category" :slug="slug" :default-title-key="defaultTitleKey" />
</template>
