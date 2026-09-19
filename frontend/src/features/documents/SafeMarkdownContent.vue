<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import {
    renderSafeMarkdown,
    type DocumentHeading,
    type SafeMarkdownResult,
} from '@/features/documents/safeMarkdown'

const props = defineProps<{
    markdown: string
    initialResult?: SafeMarkdownResult
}>()
const emit = defineEmits<{
    rendered: [headings: readonly DocumentHeading[]]
}>()
const rendered = ref<SafeMarkdownResult>(props.initialResult ?? { html: '', headings: [] })

async function render(markdown: string) {
    rendered.value = renderSafeMarkdown(markdown)
    await nextTick()
    emit('rendered', rendered.value.headings)
}

onMounted(() => {
    if (props.initialResult) {
        emit('rendered', props.initialResult.headings)
        return
    }
    void render(props.markdown)
})
watch(() => props.markdown, (markdown) => void render(markdown), { flush: 'post' })
</script>

<template>
    <!-- 内容只来自 renderSafeMarkdown 的 DOMPurify 允许列表。 -->
    <!-- eslint-disable vue/no-v-html -- 仅渲染 DOMPurify 允许列表的净化结果。 -->
    <article
        class="document-content"
        data-testid="document-content"
        v-html="rendered.html"
    ></article>
    <!-- eslint-enable vue/no-v-html -->
</template>

<style scoped>
.document-content {
    @apply break-words text-base leading-8 text-ink;
}

.document-content :deep(h2) {
    @apply mb-4 mt-12 scroll-mt-32 text-2xl font-semibold tracking-tight first:mt-0 sm:text-3xl;
}

.document-content :deep(h3) {
    @apply mb-3 mt-9 scroll-mt-32 text-xl font-semibold;
}

.document-content :deep(h4) {
    @apply mb-2 mt-7 scroll-mt-32 text-lg font-semibold;
}

.document-content :deep(h5),
.document-content :deep(h6) {
    @apply mb-2 mt-6 scroll-mt-32 text-base font-semibold;
}

.document-content :deep(p) {
    @apply my-4 text-muted;
}

.document-content :deep(ul) {
    @apply my-5 list-disc space-y-2 pl-6 text-muted marker:text-brand;
}

.document-content :deep(ol) {
    @apply my-5 list-decimal space-y-2 pl-6 text-muted marker:text-brand;
}

.document-content :deep(li > ul),
.document-content :deep(li > ol) {
    @apply my-2;
}

.document-content :deep(strong) {
    @apply font-semibold text-ink;
}

.document-content :deep(a) {
    @apply font-medium text-brand underline decoration-brand/30 underline-offset-4 hover:text-brand-hover;
}

.document-content :deep(blockquote) {
    @apply my-6 rounded-r-xl border-l-4 border-brand/40 bg-surface-muted px-5 py-3 text-muted;
}

.document-content :deep(blockquote p) {
    @apply my-1;
}

.document-content :deep(pre) {
    @apply my-6 overflow-x-auto rounded-2xl border border-line bg-slate-950 p-5 text-sm leading-6 text-slate-100;
}

.document-content :deep(code:not(pre code)) {
    @apply rounded bg-surface-muted px-1.5 py-0.5 text-sm text-brand;
}

.document-content :deep(.document-table-scroll) {
    @apply my-6 overflow-x-auto rounded-2xl border border-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand;
}

.document-content :deep(table) {
    @apply m-0 min-w-full border-collapse text-left text-sm;
}

.document-content :deep(th),
.document-content :deep(td) {
    @apply border-b border-r border-line px-4 py-3 last:border-r-0;
}

.document-content :deep(th) {
    @apply bg-surface-muted font-semibold;
}

.document-content :deep(tr:last-child td) {
    @apply border-b-0;
}

.document-content :deep(hr) {
    @apply my-10 border-0 border-t border-line;
}

.document-content :deep(img) {
    @apply mx-auto my-6 h-auto max-w-full rounded-2xl border border-line;
}
</style>
