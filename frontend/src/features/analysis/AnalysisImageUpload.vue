<script setup lang="ts">
import AppButton from '@/components/AppButton.vue'
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/icons/AppIcon.vue'
import { BYTE_SIZE } from '@/config/constants'
import { createPollingLoop } from '@/utils/pollingLoop'
import { selectImageAttachments } from './analysis.attachment-intake'
import { analysisUiConstraints } from './analysis.constants'
import { createUploadingDraftImage, refreshDraftImageStatuses } from './analysis.media-upload'
import { isAnalysisMediaUploadRateLimitError } from './analysis.media-upload-rate'
import { browserAnalysisMediaTransport } from './analysis.media-upload.adapter'
import AnalysisMediaPreviewDialog from './AnalysisMediaPreviewDialog.vue'
import { draftImageName, draftImageBytes, type SharedTaskImage } from './taskDraft'
import { getAnalysisMediaPreview } from '@/api/analysis'

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
const remotePreviews = ref<Record<string, { url: string; expiresAt: string; retries: number }>>({})
let isDisposed = false
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
    if (!image.file) return remotePreviews.value[image.assetId ?? '']?.url ?? ''
    const existing = objectUrls.get(image.localId)
    if (existing) {
        return existing
    }
    const created = URL.createObjectURL(image.file)
    objectUrls.set(image.localId, created)
    return created
}

async function loadRemotePreview(image: SharedTaskImage, retries = 0): Promise<void> {
    if (image.file || !image.assetId) return
    const assetId = image.assetId
    try {
        const preview = await getAnalysisMediaPreview(assetId)
        if (isDisposed || !props.images.some((candidate) => candidate.assetId === assetId)) return
        if (preview.assetId !== assetId) throw new Error('Preview asset mismatch')
        remotePreviews.value = {
            ...remotePreviews.value,
            [assetId]: { url: preview.previewUrl, expiresAt: preview.previewExpiresAt, retries },
        }
    } catch {
        if (!isDisposed)
            remotePreviews.value = {
                ...remotePreviews.value,
                [assetId]: { url: '', expiresAt: '', retries },
            }
    }
}

function refreshFailedPreview(image: SharedTaskImage): void {
    if (image.file || !image.assetId) return
    const previous = remotePreviews.value[image.assetId]
    if ((previous?.retries ?? 0) > 0) {
        remotePreviews.value = {
            ...remotePreviews.value,
            [image.assetId]: { url: '', expiresAt: '', retries: 1 },
        }
        return
    }
    void loadRemotePreview(image, 1)
}

watch(
    () =>
        props.images
            .filter((image) => !image.file)
            .map((image) => image.assetId)
            .join('|'),
    () => {
        for (const image of props.images)
            if (!image.file && image.assetId) void loadRemotePreview(image)
    },
    { immediate: true },
)

function canPreviewImage(image: SharedTaskImage) {
    return (image.status === 'processing' || image.status === 'ready') && Boolean(previewUrl(image))
}

function openImagePreview(image: SharedTaskImage) {
    if (!canPreviewImage(image)) {
        return
    }
    previewSource.value = previewUrl(image)
    previewTitle.value = image.file
        ? draftImageName(image)
        : t('workspace.upload.processedPreview', { name: draftImageName(image) })
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
        (props.firstOnly ? latestImages.slice(0, 1) : latestImages).flatMap((image) =>
            image.file ? [image.file] : [],
        ),
        selected,
        props.limits,
        {
            count: visibleImages.value.filter((image) => !image.file).length,
            bytes: visibleImages.value
                .filter((image) => !image.file)
                .reduce((total, image) => total + draftImageBytes(image), 0),
        },
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
            latestImages.filter((image) => image.status === 'processing'),
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
    isDisposed = true
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
            'border-line',
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
                class="app-button app-button--secondary shrink-0"
                :class="compact ? 'app-button--sm' : 'app-button--md'"
                :aria-disabled="mutationLocked"
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
                        'border-line',
                    ]
                    : 'mt-4 max-h-40'
            "
            data-testid="image-material-scroller"
        >
            <li
                v-if="compact && !images.length"
                class="flex h-full w-full flex-col items-center justify-center gap-4"
            >
                <AppButton
                    variant="secondary"
                    size="md"
                    icon="image"
                    type="button"
                    :disabled="mutationLocked"
                    data-testid="empty-image-upload"
                    @click="fileInput?.click()"
                >
                    {{ t(firstOnly ? 'workspace.upload.chooseCover' : 'workspace.upload.choose') }}
                </AppButton>
                <p v-if="firstOnly" class="px-1 text-center text-xs leading-relaxed text-muted">
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
                                ? t(
                                    image.file
                                        ? 'workspace.upload.preview'
                                        : 'workspace.upload.processedPreview',
                                    { name: draftImageName(image) },
                                )
                                : undefined
                        "
                        @click="openImagePreview(image)"
                    >
                        <img
                            v-if="previewUrl(image)"
                            :key="`${image.localId}:${remotePreviews[image.assetId ?? '']?.retries ?? 0}`"
                            class="h-full w-full object-cover"
                            :src="previewUrl(image)"
                            :alt="draftImageName(image)"
                            data-testid="image-material-thumbnail"
                            @error="refreshFailedPreview(image)"
                        />
                        <span
                            v-else
                            class="flex h-full items-center justify-center text-muted"
                            data-testid="image-material-thumbnail"
                            :aria-label="t('workspace.upload.previewUnavailable')"
                        ><AppIcon name="image"
                        /></span>
                    </button>
                    <div
                        v-if="image.status === 'uploading' || image.status === 'processing'"
                        class="absolute inset-0 flex items-center justify-center bg-black/35"
                        role="status"
                        :aria-label="t('workspace.upload.preparing')"
                    >
                        <div
                            v-if="image.status === 'processing' || image.uploadProgress >= 100"
                            class="flex flex-col items-center gap-1 text-white"
                            data-testid="image-processing-status"
                        >
                            <span
                                class="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none"
                                aria-hidden="true"
                            ></span>
                            <span class="text-[10px] font-semibold">{{
                                t('workspace.upload.processing')
                            }}</span>
                        </div>
                        <div
                            v-else
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
                        <AppButton
                            v-if="image.file && !image.reusable"
                            variant="secondary"
                            size="sm"
                            type="button"
                            :disabled="mutationLocked"
                            @click="retryImage(image)"
                        >
                            {{ t('workspace.upload.retry') }}
                        </AppButton>
                        <span v-else class="px-1 text-center text-xs text-white">{{
                            t('workspace.upload.reupload')
                        }}</span>
                    </div>
                    <span
                        v-else-if="image.status === 'ready'"
                        data-testid="image-ready-status"
                        class="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[10px] text-white shadow-sm"
                        aria-hidden="true"
                    >
                        <AppIcon name="check" size="sm" />
                    </span>
                    <button
                        class="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-xs text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                        type="button"
                        :disabled="mutationLocked"
                        :aria-label="t('workspace.upload.remove', { name: draftImageName(image) })"
                        @click="removeImage(image.localId)"
                    >
                        <AppIcon name="close" size="sm" />
                    </button>
                </div>
                <div v-if="!compact || coverSelectable" class="px-2 py-1.5">
                    <p v-if="!compact" class="truncate text-xs font-medium text-ink">
                        {{ draftImageName(image) }}
                    </p>
                    <p v-if="!compact" class="text-[10px] text-muted">
                        {{ formatFileSize(draftImageBytes(image)) }}
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
                            t('workspace.checkupInput.selectCover', { name: draftImageName(image) })
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
