<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import InlineFeedback from '@/components/feedback/InlineFeedback.vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import AnalysisMediaPreviewDialog from './AnalysisMediaPreviewDialog.vue'
import { resultCoverIndex } from './analysis.result-cover'
import type { AnalysisTask } from './analysis.contract'
import type { LocalHistoryImage, LocalHistoryImageLoader, LocalHistoryRecord } from './localHistory'

interface ResultImagePreview {
    readonly id: string
    readonly name: string
    readonly source: string
}

const props = defineProps<{
    task: AnalysisTask
    viewContext: 'current' | 'history'
    historyRecord: LocalHistoryRecord | null
    loadOriginalImage: LocalHistoryImageLoader
}>()

const { t } = useI18n()
const imagePreviews = ref<ResultImagePreview[]>([])
const loading = ref(false)
const loadFailed = ref(false)
const previewSource = ref('')
const previewTitle = ref('')
let loadVersion = 0

const contentKind = computed(() => props.task.standardTask.contentKind)
const showImageSection = computed(() => props.historyRecord !== null)
const showVideoSection = computed(() => contentKind.value === 'video')
const coverImageId = computed(
    () => props.historyRecord?.originalImages[resultCoverIndex(props.task.standardTask)]?.id,
)

function revokeImagePreviews() {
    imagePreviews.value.forEach((image) => URL.revokeObjectURL(image.source))
    imagePreviews.value = []
}

function closePreview() {
    previewSource.value = ''
    previewTitle.value = ''
}

function openPreview(image: ResultImagePreview) {
    previewSource.value = image.source
    previewTitle.value = image.name
}

async function loadImages() {
    const version = ++loadVersion
    closePreview()
    revokeImagePreviews()
    loading.value = false
    loadFailed.value = false
    const record = props.historyRecord
    if (!record) {
        loadFailed.value = true
        return
    }
    if (record.originalImages.length === 0) {
        loadFailed.value = true
        return
    }

    loading.value = true
    try {
        const files = await Promise.all(
            (showVideoSection.value
                ? record.originalImages.slice(0, 1)
                : record.originalImages
            ).map((image) => props.loadOriginalImage(record.taskId, image.id)),
        )
        if (version !== loadVersion) return
        const available = files.filter((file): file is LocalHistoryImage => file !== null)
        imagePreviews.value = available.map((file) => ({
            id: file.metadata.id,
            name: file.metadata.name,
            source: URL.createObjectURL(file.content),
        }))
        loadFailed.value =
            available.length !== (showVideoSection.value ? 1 : record.originalImages.length)
    } catch {
        if (version === loadVersion) loadFailed.value = true
    } finally {
        if (version === loadVersion) loading.value = false
    }
}

watch(
    () => [
        props.task.id,
        props.task.standardTask.contentKind,
        props.viewContext,
        props.historyRecord?.savedAt,
        props.historyRecord?.originalImages.map((image) => image.id).join('|'),
    ],
    () => void loadImages(),
    { immediate: true },
)

onBeforeUnmount(() => {
    loadVersion += 1
    revokeImagePreviews()
})
</script>

<template>
    <section data-testid="analysis-result-media">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-muted">
            {{
                showVideoSection
                    ? t('workspace.result.media.video')
                    : t('workspace.result.media.images')
            }}
        </h3>

        <div
            v-if="showImageSection && loading"
            class="mt-3 flex flex-wrap gap-3"
            aria-hidden="true"
            data-testid="analysis-result-images-loading"
        >
            <span
                v-for="image in historyRecord?.originalImages ?? []"
                :key="image.id"
                class="h-24 w-24 animate-pulse rounded-xl bg-surface-muted"
            ></span>
        </div>

        <ul v-else-if="showImageSection && imagePreviews.length" class="mt-3 flex flex-wrap gap-3">
            <li v-for="image in imagePreviews" :key="image.id">
                <button
                    class="group relative w-28 overflow-hidden rounded-xl border border-line bg-surface-muted text-left transition hover:border-brand/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    type="button"
                    :aria-label="t('workspace.result.media.previewImage', { name: image.name })"
                    @click="openPreview(image)"
                >
                    <img
                        class="aspect-square w-full object-cover transition duration-200 group-hover:scale-[1.03]"
                        :src="image.source"
                        :alt="image.name"
                        data-testid="analysis-result-image"
                    />
                    <span
                        v-if="image.id === coverImageId"
                        class="absolute left-1 top-1 rounded-md bg-ink/85 px-2 py-0.5 text-xs font-semibold text-surface"
                        data-testid="analysis-result-cover-badge"
                    >
                        {{ t('workspace.result.media.cover') }}
                    </span>
                    <span
                        v-if="showVideoSection"
                        class="pointer-events-none absolute left-1/2 top-8 -translate-x-1/2 rounded-full bg-ink/80 p-3 text-surface"
                        aria-hidden="true"
                        data-testid="analysis-result-video-marker"
                    >
                        <AppIcon name="play" size="lg" />
                    </span>
                    <span class="block truncate px-2 py-1.5 text-xs text-muted">
                        {{ image.name }}
                    </span>
                </button>
            </li>
        </ul>

        <div
            v-else-if="showVideoSection"
            class="mt-3 flex w-36 flex-col items-center justify-center gap-2 rounded-2xl border border-line bg-surface-muted px-4 py-5 text-center"
            data-testid="analysis-result-video-placeholder"
        >
            <span
                class="flex h-11 w-11 items-center justify-center rounded-xl bg-brand/10 text-brand"
                aria-hidden="true"
            >
                <AppIcon name="video" size="lg" />
            </span>
            <span class="text-sm font-semibold text-ink">
                {{ t('workspace.result.media.videoPlaceholder') }}
            </span>
        </div>

        <p v-if="showVideoSection" class="mt-2 text-xs text-muted">
            {{ t('workspace.result.media.videoCoverNotice') }}
        </p>

        <InlineFeedback
            v-if="loadFailed"
            class="mt-3"
            compact
            :feedback="{
                key: 'analysis.result.local-images',
                scope: 'module',
                tone: 'warning',
                message: t('workspace.result.media.imagesUnavailable'),
            }"
        />
    </section>

    <AnalysisMediaPreviewDialog
        :open="Boolean(previewSource)"
        kind="image"
        :source="previewSource"
        :title="previewTitle"
        :close-label="t('common.close')"
        @update:open="closePreview"
    />
</template>
