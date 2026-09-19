<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import InlineFeedback from '@/components/feedback/InlineFeedback.vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import PublicSiteLayout from '@/components/PublicSiteLayout.vue'
import { HTTP_STATUS } from '@/config/constants'
import { getPublicPage, getPublicPageCanonical } from '@/config/publicPages'
import { publicSite } from '@/config/publicSite'
import DocumentIcon from '@/features/documents/DocumentIcon.vue'
import {
    documentAdapter,
    type PublicDocument,
    type PublicDocumentCategory,
    type PublicDocumentSlug,
} from '@/features/documents/document.adapter'
import SafeMarkdownContent from '@/features/documents/SafeMarkdownContent.vue'
import {
    getDocumentBodyMarkdown,
    type DocumentHeading,
} from '@/features/documents/safeMarkdown'
import { prerenderDataKey } from '@/prerender/prerenderData'
import { ApiRequestError, getApiRequestErrorMessage } from '@/utils/apiRequestError'

const props = defineProps<{
    category: PublicDocumentCategory
    slug: PublicDocumentSlug
    defaultTitleKey: string
}>()

const prerenderData = inject(prerenderDataKey, {})
const initialDocument =
    prerenderData.document?.value.category === props.category &&
    prerenderData.document.value.slug === props.slug
        ? prerenderData.document
        : undefined
const { locale, t } = useI18n()
const route = useRoute()
const document = ref<PublicDocument | null>(initialDocument?.value ?? null)
const loading = ref(!initialDocument)
const state = ref<'success' | 'not-found' | 'error'>('success')
const errorMessage = ref('')
const headings = ref<readonly DocumentHeading[]>(initialDocument?.body.headings ?? [])
const activeHeadingId = ref('')
let headingObserver: IntersectionObserver | null = null
let documentRequestVersion = 0
let canUseInitialDocument = Boolean(initialDocument)
const nestedHeadingLevel = 3
const deepHeadingLevel = 4
const headingObserverRootMargin = '-96px 0px -72% 0px'
const documentTitle = computed(() => document.value?.meta.title || t(props.defaultTitleKey))
const bodyMarkdown = computed(() => getDocumentBodyMarkdown(document.value?.markdown ?? ''))
const documentStructuredData = computed(() => {
    const page = getPublicPage(route.path)
    const structuredDataType = page?.document?.structuredDataType
    const canonical = getPublicPageCanonical(route.path)
    const currentDocument = document.value
    if (!structuredDataType || !canonical || !currentDocument) return null

    return {
        '@context': 'https://schema.org',
        '@type': structuredDataType,
        headline: documentTitle.value,
        description: currentDocument.meta.description,
        dateModified: currentDocument.meta.updatedAt,
        inLanguage: currentDocument.locale,
        mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
        publisher: {
            '@type': 'Organization',
            '@id': `${publicSite.canonicalUrl}/#organization`,
            name: publicSite.operatorName,
        },
    }
})
const formattedUpdatedAt = computed(() => {
    const value = document.value?.meta.updatedAt
    if (!value) return ''
    const date = new Date(`${value}T00:00:00Z`)
    if (Number.isNaN(date.getTime())) return ''
    return new Intl.DateTimeFormat(locale.value, { dateStyle: 'long', timeZone: 'UTC' }).format(
        date,
    )
})

useHead({
    script: () => {
        const data = documentStructuredData.value
        return data
            ? [
                  {
                      key: 'document-json-ld',
                      type: 'application/ld+json',
                      innerHTML: JSON.stringify(data).replace(/</gu, '\\u003c'),
                  },
              ]
            : []
    },
})

function headingIndentClass(level: number) {
    if (level >= deepHeadingLevel) return 'ml-6 text-xs'
    if (level === nestedHeadingLevel) return 'ml-3'
    return ''
}

function scrollToCurrentHash() {
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (!id) return
    const target = window.document.getElementById(id)
    if (!target) return
    activeHeadingId.value = id
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** 接收净化后的标题列表，并恢复初始 hash 与滚动章节高亮。 */
async function handleContentRendered(nextHeadings: readonly DocumentHeading[]) {
    headings.value = nextHeadings
    activeHeadingId.value = nextHeadings[0]?.id ?? ''
    await nextTick()
    headingObserver?.disconnect()
    headingObserver = new IntersectionObserver(
        (entries) => {
            const current = entries.find((entry) => entry.isIntersecting)
            if (current?.target.id) activeHeadingId.value = current.target.id
        },
        { rootMargin: headingObserverRootMargin, threshold: [0, 1] },
    )
    for (const heading of nextHeadings) {
        const element = window.document.getElementById(heading.id)
        if (element) headingObserver.observe(element)
    }
    requestAnimationFrame(scrollToCurrentHash)
}

/** 按当前界面语言加载当前公开文档。 */
async function loadDocument() {
    const requestedLocale = locale.value === 'zh-CN' ? 'zh-CN' : 'en-US'
    if (
        canUseInitialDocument &&
        initialDocument?.value.category === props.category &&
        initialDocument?.value.slug === props.slug &&
        initialDocument.value.locale === requestedLocale
    ) {
        canUseInitialDocument = false
        document.value = initialDocument.value
        loading.value = false
        state.value = 'success'
        return
    }
    canUseInitialDocument = false
    const requestVersion = ++documentRequestVersion
    loading.value = true
    state.value = 'success'
    errorMessage.value = ''
    try {
        const response = await documentAdapter.getPublicDocument(
            requestedLocale,
            props.category,
            props.slug,
        )
        if (requestVersion !== documentRequestVersion) return
        document.value = response.data.data.document
    } catch (error) {
        if (requestVersion !== documentRequestVersion) return
        document.value = null
        if (error instanceof ApiRequestError && error.status === HTTP_STATUS.NOT_FOUND) {
            state.value = 'not-found'
        } else {
            state.value = 'error'
            errorMessage.value = getApiRequestErrorMessage(error, t('common.requestFailed'))
        }
    } finally {
        if (requestVersion === documentRequestVersion) loading.value = false
    }
}

watch(() => [locale.value, props.category, props.slug], loadDocument, { immediate: true })

onMounted(() => window.addEventListener('hashchange', scrollToCurrentHash))
onBeforeUnmount(() => {
    documentRequestVersion += 1
    headingObserver?.disconnect()
    window.removeEventListener('hashchange', scrollToCurrentHash)
})
</script>

<template>
    <PublicSiteLayout>
        <main class="relative flex-1" data-testid="document-page">
            <div
                class="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_24%_0%,rgb(var(--color-brand-vivid)/0.12),transparent_48%)]"
            ></div>
            <div class="relative mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16 lg:px-10">
                <RouterLink class="text-sm font-medium text-muted hover:text-brand" to="/">
                    <AppIcon class="mr-1 inline-block" name="arrow-left" size="sm" />
                    {{ t('documents.backHome') }}
                </RouterLink>

                <div v-if="loading" class="mt-14 space-y-4" data-testid="document-loading">
                    <div class="h-10 w-64 animate-pulse rounded-xl bg-surface-muted"></div>
                    <div class="h-5 w-full max-w-xl animate-pulse rounded bg-surface-muted"></div>
                    <div class="mt-12 h-72 animate-pulse rounded-3xl bg-surface-muted"></div>
                </div>

                <section
                    v-else-if="state === 'not-found'"
                    class="mt-14 rounded-3xl border border-line bg-surface p-8 text-center"
                    data-testid="document-not-found"
                >
                    <h1 class="text-3xl font-semibold">{{ t('documents.notFoundTitle') }}</h1>
                    <p class="mt-3 text-muted">{{ t('documents.notFoundDescription') }}</p>
                </section>

                <section
                    v-else-if="state === 'error'"
                    class="mt-14 rounded-3xl border border-line bg-surface p-8 text-center"
                    data-testid="document-error"
                >
                    <h1 class="text-3xl font-semibold">{{ t('documents.errorTitle') }}</h1>
                    <InlineFeedback
                        class="mt-5 text-left"
                        :feedback="{
                            key: 'documents.load',
                            scope: 'page',
                            tone: 'error',
                            message: errorMessage,
                            action: {
                                kind: 'retry',
                                label: t('documents.retry'),
                            },
                        }"
                        @action="loadDocument"
                    />
                </section>

                <template v-else-if="document">
                    <header class="mt-10 border-b border-line pb-10">
                        <div
                            class="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-brand/25 bg-brand/10 text-brand"
                        >
                            <DocumentIcon :name="document.meta.icon" />
                        </div>
                        <h1 class="text-4xl font-semibold tracking-tight sm:text-5xl">
                            {{ documentTitle }}
                        </h1>
                        <p
                            v-if="document.meta.description"
                            class="mt-4 max-w-3xl text-base leading-7 text-muted"
                        >
                            {{ document.meta.description }}
                        </p>
                        <div class="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
                            <span v-if="document.meta.version">{{
                                t('documents.version', { version: document.meta.version })
                            }}</span>
                            <span v-if="formattedUpdatedAt">{{
                                t('documents.updatedAt', { date: formattedUpdatedAt })
                            }}</span>
                        </div>
                    </header>

                    <div
                        v-if="bodyMarkdown"
                        class="mt-10"
                        :class="
                            headings.length
                                ? 'lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10'
                                : 'mx-auto max-w-3xl'
                        "
                    >
                        <aside
                            v-if="headings.length"
                            class="hidden lg:block"
                            data-testid="document-toc-desktop"
                        >
                            <nav
                                class="sticky top-28 max-h-[calc(100dvh-8rem)] overflow-y-auto border-l border-line pl-4 pr-2"
                                :aria-label="t('documents.tableOfContents')"
                            >
                                <p
                                    class="mb-3 text-xs font-semibold uppercase tracking-wider text-muted"
                                >
                                    {{ t('documents.tableOfContents') }}
                                </p>
                                <a
                                    v-for="heading in headings"
                                    :key="heading.id"
                                    class="block border-l-2 py-2 pr-2 text-sm transition"
                                    :class="[
                                        headingIndentClass(heading.level),
                                        activeHeadingId === heading.id
                                            ? 'border-brand pl-3 font-semibold text-brand'
                                            : 'border-transparent pl-3 text-muted hover:text-ink',
                                    ]"
                                    :href="`#${heading.id}`"
                                    :aria-current="
                                        activeHeadingId === heading.id ? 'location' : undefined
                                    "
                                    @click="activeHeadingId = heading.id"
                                >{{ heading.text }}</a
                                >
                            </nav>
                        </aside>

                        <div class="min-w-0">
                            <details
                                v-if="headings.length"
                                class="mb-5 rounded-2xl border border-line bg-surface p-4 lg:hidden"
                                data-testid="document-toc-mobile"
                            >
                                <summary class="cursor-pointer text-sm font-semibold">
                                    {{ t('documents.tableOfContents') }}
                                </summary>
                                <nav
                                    class="mt-3 grid max-h-[60dvh] gap-1 overflow-y-auto pr-1"
                                    :aria-label="t('documents.tableOfContents')"
                                >
                                    <a
                                        v-for="heading in headings"
                                        :key="heading.id"
                                        class="rounded-lg px-3 py-2 text-sm"
                                        :class="[
                                            headingIndentClass(heading.level),
                                            activeHeadingId === heading.id
                                                ? 'bg-brand/10 font-semibold text-brand'
                                                : 'text-muted',
                                        ]"
                                        :href="`#${heading.id}`"
                                        :aria-current="
                                            activeHeadingId === heading.id ? 'location' : undefined
                                        "
                                        @click="activeHeadingId = heading.id"
                                    >{{ heading.text }}</a
                                    >
                                </nav>
                            </details>
                            <section
                                class="rounded-3xl border border-line bg-surface p-6 shadow-sm sm:p-10"
                            >
                                <SafeMarkdownContent
                                    :markdown="bodyMarkdown"
                                    :initial-result="initialDocument?.body"
                                    @rendered="handleContentRendered"
                                />
                            </section>
                        </div>
                    </div>
                    <section
                        v-else
                        class="mt-10 rounded-3xl border border-line bg-surface p-8 text-center"
                        data-testid="document-empty"
                    >
                        <h2 class="text-2xl font-semibold">{{ t('documents.emptyTitle') }}</h2>
                        <p class="mt-3 text-muted">{{ t('documents.emptyDescription') }}</p>
                    </section>
                </template>
            </div>
        </main>
    </PublicSiteLayout>
</template>
