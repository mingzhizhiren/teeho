<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/icons/AppIcon.vue'
import { BYTE_SIZE } from '@/config/constants'
import { createPollingLoop } from '@/utils/pollingLoop'
import { selectImageAttachments } from './analysis.attachment-intake'
import { analysisUiConstraints } from './analysis.constants'
import {
    createUploadingDraftImage,
    refreshDraftImageStatuses,
} from './analysis.media-upload'
import { isAnalysisMediaUploadRateLimitError } from './analysis.media-upload-rate'
import { browserAnalysisMediaTransport } from './analysis.media-upload.adapter'
import AnalysisMediaPreviewDialog from './AnalysisMediaPreviewDialog.vue'
import type { SharedTaskImage } from './taskDraft'

const props = withDefaults(
    defineProps<{
        images: SharedTaskImage[]
        uploadDraftImages: (images: SharedTaskImage[]) => Promise<void>
        retryDraftImage: (image: SharedTaskImage) => Promise<void>
        compact?: boolean
        stacked?: boolean
        firstOnly?: boolean
        invalid?: boolean
        mutationLocked?: boolean
        coverSelectable?: boolean
        coverLocalId?: string | null
        limits: {
            allowedMediaTypes: Array<'image/jpeg' | 'image/png' | 'image/webp'>
            maxFiles: number
            maxFileBytes: number
            maxTotalBytes: number
        }
    }>(),
    {
        compact: false,
        stacked: false,
        firstOnly: false,
        mutationLocked: false,
        coverSelectable: false,
        coverLocalId: null,
    },
)
const emit = defineEmits<{
    'update:images': [images: SharedTaskImage[]]
    'update:cover': [localId: string]
    'draft-reset-required': []
    error: [message: string]
}>()
const { t } = useI18n()
const fileInput = ref<HTMLInputElement | null>(null)
const objectUrls = new Map<string, string>()
const previewSource = ref('')
const previewTitle = ref('')
let latestImages = props.images
const visibleImages = computed(() => (props.firstOnly ? props.images.slice(0, 1) : props.images))

function updateImages(images: SharedTaskImage[]) {
    latestImages = images
    emit('update:images', images)
}

function formatMegabytes(bytes: number) {
    return Math.round(bytes / BYTE_SIZE.MEBIBYTE)
}

function formatFileSize(bytes: number) {
    if (bytes >= BYTE_SIZE.MEBIBYTE) {
        return `${(bytes / BYTE_SIZE.MEBIBYTE).toFixed(1)} MB`
    }
    return `${Math.ceil(bytes / BYTE_SIZE.KIBIBYTE)} KB`
}

function previewUrl(image: SharedTaskImage) {
    const existing = objectUrls.get(image.localId)
    if (existing) {
        return existing
    }
    const created = URL.createObjectURL(image.file)
    objectUrls.set(image.localId, created)
    return created
}

function canPreviewImage(image: SharedTaskImage) {
    return image.status === 'processing' || image.status === 'ready'
}

function openImagePreview(image: SharedTaskImage) {
    if (!canPreviewImage(image)) {
        return
    }
    previewSource.value = previewUrl(image)
    previewTitle.value = image.file.name
}

function closeImagePreview() {
    previewSource.value = ''
    previewTitle.value = ''
}

function emitMergedImages(updated: SharedTaskImage[]) {
    const updates = new Map(updated.map((image) => [image.localId, image]))
    updateImages(latestImages.map((image) => updates.get(image.localId) ?? image))
}

async function selectFiles(event: Event) {
    const input = event.target as HTMLInputElement
    if (props.mutationLocked) {
        input.value = ''
        return
    }
    const selected = Array.from(input.files ?? [])
    input.value = ''
    await acceptFiles(selected)
}

/** 三种文件入口共用校验与上传流程。 */
async function acceptFiles(selected: File[]): Promise<void> {
    if (props.mutationLocked) return
    const selection = selectImageAttachments(
        (props.firstOnly ? latestImages.slice(0, 1) : latestImages).map((image) => image.file),
        selected,
        props.limits,
    )
    if (selection.error) {
        emit('error', t(`workspace.upload.${selection.error}`, { count: props.limits.maxFiles }))
    }
    const appended = selection.files
    if (!appended.length) return
    const pending = appended.map((file) => createUploadingDraftImage(file))
    await props.uploadDraftImages(pending)
}

function removeImage(localId: string) {
    if (props.mutationLocked) return
    const url = objectUrls.get(localId)
    if (url) {
        URL.revokeObjectURL(url)
        objectUrls.delete(localId)
    }
    updateImages(latestImages.filter((image) => image.localId !== localId))
}

async function retryImage(image: SharedTaskImage) {
    if (props.mutationLocked) return
    await props.retryDraftImage(image)
}

defineExpose({ acceptFiles })

const polling = createPollingLoop(analysisUiConstraints.mediaStatusPollingIntervalMs, async () => {
    try {
        const refreshed = await refreshDraftImageStatuses(
            latestImages,
            browserAnalysisMediaTransport,
        )
        emitMergedImages(refreshed)
    } catch (error) {
        if (!isAnalysisMediaUploadRateLimitError(error)) throw error
        updateImages([])
        emit('draft-reset-required')
        emit('error', t('workspace.upload.rateLimited'))
    }
})

watch(
    () => [...props.images],
    (images) => {
        latestImages = images
    },
    { flush: 'sync' },
)

watch(
    () => props.images.some((image) => image.status === 'processing'),
    (hasProcessing) => {
        if (hasProcessing) {
            polling.start()
        } else {
            polling.stop()
        }
    },
    { immediate: true },
)

watch(
    () => new Set(props.images.map((image) => image.localId)),
    (currentIds) => {
        for (const [localId, url] of objectUrls) {
            if (!currentIds.has(localId)) {
                URL.revokeObjectURL(url)
                objectUrls.delete(localId)
            }
        }
    },
)

onUnmounted(() => {
    polling.stop()
    for (const url of objectUrls.values()) {
        URL.revokeObjectURL(url)
    }
    objectUrls.clear()
})
</script>

<template>
    <div
        :aria-invalid="invalid || undefined"
        :class="[
            !compact && invalid
                ? 'border-red-500 ring-1 ring-red-500 dark:border-red-400 dark:ring-red-400'
                : 'border-line',
            compact
                ? 'relative flex h-full min-h-0 flex-1 flex-col'
                : 'rounded-2xl border border-dashed bg-surface-muted p-4',
        ]"
    >
        <div
            class="flex gap-2"
            :class="[
                compact
                    ? 'h-9 flex-row items-center justify-between xl:absolute xl:inset-x-0 xl:-top-11'
                    : stacked
                        ? 'flex-col'
                        : 'flex-row items-center justify-between',
                compact ? 'shrink-0' : '',
            ]"
        >
            <div class="min-w-0 flex-1">
                <p
                    class="text-muted"
                    :class="compact ? 'truncate text-xs' : 'text-xs leading-5'"
                    :title="
                        t('workspace.upload.limits', {
                            count: limits.maxFiles,
                            fileSize: formatMegabytes(limits.maxFileBytes),
                            totalSize: formatMegabytes(limits.maxTotalBytes),
                        })
                    "
                >
                    {{
                        t('workspace.upload.limits', {
                            count: limits.maxFiles,
                            fileSize: formatMegabytes(limits.maxFileBytes),
                            totalSize: formatMegabytes(limits.maxTotalBytes),
                        })
                    }}
                </p>
            </div>
            <label
                class="shrink-0 cursor-pointer border border-line bg-surface text-center font-semibold text-ink transition hover:border-brand/50 hover:bg-brand/5"
                :class="[
                    compact ? 'rounded-lg px-3 py-2 text-xs' : 'rounded-xl px-4 py-2.5 text-sm',
                    mutationLocked ? 'cursor-not-allowed opacity-50' : '',
                ]"
            >
                {{ t(firstOnly ? 'workspace.upload.chooseCover' : 'workspace.upload.choose') }}
                <input
                    ref="fileInput"
                    class="sr-only"
                    type="file"
                    :multiple="limits.maxFiles > 1"
                    :disabled="mutationLocked"
                    accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                    @change="selectFiles"
                />
            </label>
        </div>

        <ul
            v-if="images.length || compact"
            class="flex flex-wrap content-start gap-2 overflow-y-auto overscroll-contain pr-1"
            :class="
                compact
                    ? [
                        'mt-2 min-h-0 flex-1 rounded-2xl border border-dashed bg-surface-muted p-2 xl:mt-0',
                        invalid ? 'border-red-500 dark:border-red-400' : 'border-line',
                    ]
                    : 'mt-4 max-h-40'
            "
            data-testid="image-material-scroller"
        >
            <li
                v-if="compact && !images.length"
                class="flex h-full w-full flex-col items-center justify-center gap-4"
            >
                <button
                    type="button"
                    class="rounded-xl border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink transition hover:border-brand/50 hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="mutationLocked"
                    data-testid="empty-image-upload"
                    @click="fileInput?.click()"
                >
                    {{ t(firstOnly ? 'workspace.upload.chooseCover' : 'workspace.upload.choose') }}
                </button>
                <p
                    v-if="firstOnly"
                    class="px-1 text-center text-xs leading-relaxed text-muted"
                >
                    {{ t('workspace.upload.defaultVideoCover') }}
                </p>
            </li>
            <li
                v-for="image in visibleImages"
                :key="image.localId"
                class="w-20 flex-none overflow-hidden rounded-lg border border-line bg-surface"
            >
                <div class="relative aspect-square overflow-hidden bg-canvas">
                    <button
                        class="h-full w-full disabled:cursor-default"
                        :class="canPreviewImage(image) ? 'cursor-zoom-in' : ''"
                        type="button"
                        :disabled="!canPreviewImage(image)"
                        :aria-label="
                            canPreviewImage(image)
                                ? t('workspace.upload.preview', { name: image.file.name })
                                : undefined
                        "
                        @click="openImagePreview(image)"
                    >
                        <img
                            class="h-full w-full object-cover"
                            :src="previewUrl(image)"
                            :alt="image.file.name"
                            data-testid="image-material-thumbnail"
                        />
                    </button>
                    <div
                        v-if="image.status === 'uploading' || image.status === 'processing'"
                        class="absolute inset-0 flex items-center justify-center bg-black/35"
                        role="status"
                        :aria-label="t('workspace.upload.preparing')"
                    >
                        <div
                            class="relative flex h-11 w-11 items-center justify-center"
                            role="progressbar"
                            :aria-label="
                                t('workspace.upload.progress', {
                                    progress: image.uploadProgress,
                                })
                            "
                            aria-valuemin="0"
                            aria-valuemax="100"
                            :aria-valuenow="image.uploadProgress"
                            data-testid="image-upload-progress"
                        >
                            <svg
                                class="absolute inset-0 h-11 w-11 -rotate-90"
                                viewBox="0 0 44 44"
                                aria-hidden="true"
                            >
                                <circle
                                    cx="22"
                                    cy="22"
                                    r="18"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="4"
                                    class="text-white/35"
                                />
                                <circle
                                    cx="22"
                                    cy="22"
                                    r="18"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="4"
                                    stroke-linecap="round"
                                    pathLength="100"
                                    stroke-dasharray="100"
                                    :stroke-dashoffset="100 - image.uploadProgress"
                                    class="text-white transition-all duration-200"
                                />
                            </svg>
                            <span
                                class="relative text-[10px] font-bold text-white"
                                data-testid="image-upload-progress-value"
                            >
                                {{ image.uploadProgress }}%
                            </span>
                        </div>
                    </div>
                    <div
                        v-else-if="image.status === 'failed'"
                        class="absolute inset-0 flex items-center justify-center bg-black/45"
                    >
                        <button
                            class="rounded-full bg-surface/95 px-3 py-1.5 text-xs font-semibold text-red-600 shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                            type="button"
                            :disabled="mutationLocked"
                            @click="retryImage(image)"
                        >
                            {{ t('workspace.upload.retry') }}
                        </button>
                    </div>
                    <span
                        v-else
                        class="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[10px] text-white shadow-sm"
                        aria-hidden="true"
                    >
                        <AppIcon name="check" size="sm" />
                    </span>
                    <button
                        class="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-xs text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                        type="button"
                        :disabled="mutationLocked"
                        :aria-label="t('workspace.upload.remove', { name: image.file.name })"
                        @click="removeImage(image.localId)"
                    >
                        <AppIcon name="close" size="sm" />
                    </button>
                </div>
                <div v-if="!compact || coverSelectable" class="px-2 py-1.5">
                    <p v-if="!compact" class="truncate text-xs font-medium text-ink">
                        {{ image.file.name }}
                    </p>
                    <p v-if="!compact" class="text-[10px] text-muted">
                        {{ formatFileSize(image.file.size) }}
                    </p>
                    <button
                        v-if="coverSelectable"
                        type="button"
                        class="mt-2 min-h-8 w-full rounded-md px-1 py-1 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
                        :class="
                            (coverLocalId ?? images[0]?.localId) === image.localId
                                ? 'bg-brand/10 text-brand'
                                : 'bg-surface-muted text-muted hover:text-ink'
                        "
                        :aria-pressed="(coverLocalId ?? images[0]?.localId) === image.localId"
                        :aria-label="
                            t('workspace.checkupInput.selectCover', { name: image.file.name })
                        "
                        :disabled="mutationLocked"
                        @click="emit('update:cover', image.localId)"
                    >
                        {{
                            (coverLocalId ?? images[0]?.localId) === image.localId
                                ? t('workspace.checkupInput.coverSelected')
                                : t('workspace.checkupInput.makeCover')
                        }}
                    </button>
                </div>
            </li>
        </ul>
    </div>

    <AnalysisMediaPreviewDialog
        :open="Boolean(previewSource)"
        kind="image"
        :source="previewSource"
        :title="previewTitle"
        :close-label="t('common.close')"
        @update:open="closeImagePreview"
    />
</template>
