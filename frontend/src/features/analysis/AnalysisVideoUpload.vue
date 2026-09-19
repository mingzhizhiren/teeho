<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { BYTE_SIZE } from '@/config/constants'
import AppConfirmDialog from '@/components/AppConfirmDialog.vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import { useWorkspaceEventsStore } from '@/stores/workspaceEvents'
import { createPollingLoop } from '@/utils/pollingLoop'
import { selectVideoAttachment } from './analysis.attachment-intake'
import { analysisUiConstraints } from './analysis.constants'
import { resolveVideoFailureMessageKey } from './analysis.video-errors'
import { isAnalysisMediaUploadRateLimitError } from './analysis.media-upload-rate'
import {
    attachDraftVideoFile,
    createUploadingDraftVideo,
    refreshDraftVideoStatus,
    uploadDraftVideo,
    type BrowserVideoSelectionError,
} from './analysis.video-upload'
import { browserAnalysisVideoTransport } from './analysis.video-upload.adapter'
import AnalysisMediaPreviewDialog from './AnalysisMediaPreviewDialog.vue'
import type { SharedTaskVideo } from './taskDraft'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
    defineProps<{
        video: SharedTaskVideo | null
        mutationLocked?: boolean
        stacked?: boolean
        compact?: boolean
        invalid?: boolean
        limits: {
            allowedMediaTypes: Array<'video/mp4' | 'video/quicktime'>
            maxFileBytes: number
        }
    }>(),
    { mutationLocked: false, stacked: false, compact: false },
)
const emit = defineEmits<{
    'update:video': [video: SharedTaskVideo | null]
    'draft-reset-required': []
    error: [message: string]
}>()
const { t } = useI18n()
const workspaceEvents = useWorkspaceEventsStore()
const fileInput = ref<HTMLInputElement | null>(null)
const operationPending = ref(false)
const confirmationOpen = ref(false)
const previewSource = ref('')
const pendingVideoMutation = ref<{ kind: 'replace'; file: File } | { kind: 'remove' } | null>(null)
let latestVideo = props.video
let uploadGeneration = 0
let uploadController: AbortController | null = null
let statusErrorVisible = false
let failureLabelTimer: ReturnType<typeof setTimeout> | null = null

const failureLabelDelayMs = 300
const isFailureLabelVisible = ref(false)

const maximumMegabytes = computed(() => Math.round(props.limits.maxFileBytes / BYTE_SIZE.MEBIBYTE))
const statusLabel = computed(() => {
    if (!props.video) {
        return ''
    }
    if (props.video.status === 'queued') {
        return t('workspace.video.statuses.queued')
    }
    if (props.video.status === 'failed') {
        return isFailureLabelVisible.value
            ? t(resolveVideoFailureMessageKey(props.video.errorCode))
            : ''
    }
    return t(`workspace.video.statuses.${props.video.status}`)
})
const statusColor = computed(() => {
    if (props.video?.status === 'failed') {
        return 'text-red-600 dark:text-red-300'
    }
    if (props.video?.status === 'upload_paused') {
        return 'text-amber-700 dark:text-amber-200'
    }
    return 'text-brand'
})
const confirmationTitle = computed(() =>
    pendingVideoMutation.value?.kind === 'replace'
        ? t('workspace.video.replaceConfirmTitle')
        : t('workspace.video.removeConfirmTitle'),
)
const confirmationDescription = computed(() =>
    pendingVideoMutation.value?.kind === 'replace'
        ? t('workspace.video.replaceConfirm')
        : t('workspace.video.removeConfirm'),
)
const confirmationLabel = computed(() =>
    pendingVideoMutation.value?.kind === 'replace'
        ? t('workspace.video.replaceConfirmAction')
        : t('workspace.video.removeConfirmAction'),
)
const canPreviewVideo = computed(
    () =>
        Boolean(props.video?.file) &&
        (props.video?.status === 'queued' ||
            props.video?.status === 'processing' ||
            props.video?.status === 'ready'),
)

const selectionMessageKeys: Record<BrowserVideoSelectionError, string> = {
    video_select_one: 'workspace.video.selectOne',
    video_invalid_type: 'workspace.video.invalidType',
    video_extension_mismatch: 'workspace.video.extensionMismatch',
    video_file_too_large: 'workspace.video.fileTooLarge',
}

function formatFileSize(bytes: number) {
    return `${(bytes / BYTE_SIZE.MEBIBYTE).toFixed(1)} MB`
}

function openFilePicker() {
    if (props.mutationLocked) return
    fileInput.value?.click()
}

function closeVideoPreview() {
    if (previewSource.value) {
        URL.revokeObjectURL(previewSource.value)
        previewSource.value = ''
    }
}

function openVideoPreview() {
    if (!canPreviewVideo.value || !props.video?.file) {
        return
    }
    closeVideoPreview()
    previewSource.value = URL.createObjectURL(props.video.file)
}

function publishVideo(video: SharedTaskVideo | null) {
    latestVideo = video
    emit('update:video', video)
}

async function refreshAuthoritativeStatus() {
    const current = latestVideo
    if (!current?.videoId) {
        return
    }
    try {
        const refreshed = await refreshDraftVideoStatus(current, browserAnalysisVideoTransport)
        if (latestVideo?.localId === current.localId) {
            publishVideo(refreshed)
        }
        statusErrorVisible = false
    } catch (error) {
        if (isAnalysisMediaUploadRateLimitError(error)) {
            publishVideo(null)
            emit('draft-reset-required')
            emit('error', t('workspace.upload.rateLimited'))
            return
        }
        if (!statusErrorVisible) {
            statusErrorVisible = true
            emit('error', t('workspace.video.statusFailed'))
        }
    }
}

async function startUpload(video: SharedTaskVideo) {
    const generation = ++uploadGeneration
    const controller = new AbortController()
    uploadController = controller
    publishVideo(video)
    let uploaded: SharedTaskVideo
    try {
        uploaded = await uploadDraftVideo(
            video,
            browserAnalysisVideoTransport,
            (current) => {
                if (generation === uploadGeneration) {
                    publishVideo(current)
                }
            },
            controller.signal,
        )
    } catch (error) {
        if (!isAnalysisMediaUploadRateLimitError(error)) throw error
        publishVideo(null)
        emit('draft-reset-required')
        emit('error', t('workspace.upload.rateLimited'))
        return
    }
    if (generation === uploadGeneration) {
        publishVideo(uploaded)
    }
    if (uploadController === controller) {
        uploadController = null
    }
}

async function cancelCurrentVideo() {
    const current = latestVideo
    if (!current) {
        return true
    }
    uploadGeneration += 1
    uploadController?.abort()
    uploadController = null
    try {
        if (current.videoId) {
            await browserAnalysisVideoTransport.cancel(current.videoId)
        }
        publishVideo(null)
        return true
    } catch {
        publishVideo(
            current.status === 'uploading'
                ? { ...current, file: null, status: 'upload_paused' }
                : current,
        )
        emit('error', t('workspace.video.cancelFailed'))
        return false
    }
}

function isSameRestorableFile(video: SharedTaskVideo, file: File) {
    return (
        video.status === 'upload_paused' &&
        file.name === video.fileName &&
        file.size === video.byteSize &&
        file.type === video.declaredMediaType
    )
}

async function selectFile(event: Event) {
    const input = event.target as HTMLInputElement
    if (props.mutationLocked) {
        input.value = ''
        return
    }
    const selected = Array.from(input.files ?? [])
    input.value = ''
    await acceptFiles(selected, true)
}

/** 显式选择允许替换；粘贴和拖入只填空位。 */
async function acceptFiles(selected: File[], allowReplace = false): Promise<void> {
    if (props.mutationLocked || operationPending.value) return
    const selection = selectVideoAttachment(
        selected,
        Boolean(latestVideo),
        allowReplace,
        props.limits,
    )
    if (selection.error) {
        emit('error', t(selectionMessageKeys[selection.error]))
        return
    }
    if (selection.skipped) emit('error', t('workspace.upload.skipped'))
    const file = selection.file
    if (!file) return
    const current = latestVideo
    if (current && isSameRestorableFile(current, file)) {
        await startUpload(attachDraftVideoFile(current, file))
        return
    }
    if (current) {
        pendingVideoMutation.value = { kind: 'replace', file }
        confirmationOpen.value = true
        return
    }
    await startUpload(createUploadingDraftVideo(file))
}

defineExpose({ acceptFiles })

function removeVideo() {
    if (!latestVideo || props.mutationLocked) {
        return
    }
    pendingVideoMutation.value = { kind: 'remove' }
    confirmationOpen.value = true
}

function cancelVideoMutation() {
    confirmationOpen.value = false
    pendingVideoMutation.value = null
}

async function confirmVideoMutation() {
    const mutation = pendingVideoMutation.value
    if (!mutation || operationPending.value || props.mutationLocked) {
        return
    }
    operationPending.value = true
    const cancelled = await cancelCurrentVideo()
    operationPending.value = false
    if (!cancelled) {
        return
    }
    cancelVideoMutation()
    if (mutation.kind === 'replace') {
        await startUpload(createUploadingDraftVideo(mutation.file))
    }
}

const polling = createPollingLoop(
    analysisUiConstraints.mediaStatusPollingIntervalMs,
    refreshAuthoritativeStatus,
)

watch(
    () => props.video,
    (video) => {
        if (video?.localId !== latestVideo?.localId) {
            uploadGeneration += 1
            uploadController?.abort()
            uploadController = null
            closeVideoPreview()
        }
        latestVideo = video
    },
)

watch(
    () => props.video?.status,
    (status) => {
        if (failureLabelTimer) {
            clearTimeout(failureLabelTimer)
            failureLabelTimer = null
        }
        isFailureLabelVisible.value = false
        if (status === 'failed') {
            failureLabelTimer = setTimeout(() => {
                if (props.video?.status === 'failed') {
                    isFailureLabelVisible.value = true
                }
                failureLabelTimer = null
            }, failureLabelDelayMs)
        }
        if (status === 'queued' || status === 'processing') {
            polling.start()
        } else {
            polling.stop()
        }
    },
    { immediate: true },
)

watch(
    () => workspaceEvents.videoRevision,
    () => {
        void refreshAuthoritativeStatus()
    },
)

onMounted(refreshAuthoritativeStatus)

onUnmounted(() => {
    if (failureLabelTimer) {
        clearTimeout(failureLabelTimer)
    }
    uploadGeneration += 1
    uploadController?.abort()
    uploadController = null
    polling.stop()
    closeVideoPreview()
})
</script>

<template>
    <div
        v-bind="$attrs"
        class="min-w-0"
        :class="[
            compact
                ? 'relative flex min-h-0 flex-1 flex-col'
                : 'rounded-2xl border border-dashed bg-surface-muted p-4',
            !compact && invalid
                ? 'border-red-500 ring-1 ring-red-500 dark:border-red-400 dark:ring-red-400'
                : 'border-line',
        ]"
        :aria-invalid="invalid || undefined"
    >
        <input
            ref="fileInput"
            class="sr-only"
            type="file"
            :disabled="mutationLocked"
            accept=".mp4,.mov,video/mp4,video/quicktime"
            @change="selectFile"
        />

        <div
            v-if="!video || compact"
            class="flex gap-2"
            :class="
                compact
                    ? 'h-9 shrink-0 items-center justify-between xl:absolute xl:inset-x-0 xl:-top-11'
                    : stacked
                        ? 'flex-col'
                        : 'flex-col sm:flex-row sm:items-center sm:justify-between'
            "
        >
            <p
                class="min-w-0 text-muted"
                :class="compact ? 'truncate text-xs' : 'text-xs leading-5'"
                :title="t('workspace.video.limits', { size: maximumMegabytes })"
            >
                {{ t('workspace.video.limits', { size: maximumMegabytes }) }}
            </p>
            <button
                v-if="!video"
                class="shrink-0 border border-line bg-surface text-center font-semibold text-ink transition hover:border-brand/50 hover:bg-brand/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50"
                :class="compact ? 'rounded-lg px-3 py-2 text-xs' : 'rounded-xl px-4 py-2.5 text-sm'"
                type="button"
                :disabled="mutationLocked"
                @click="openFilePicker"
            >
                {{ t('workspace.video.choose') }}
            </button>
        </div>

        <div
            v-if="compact && !video"
            class="mt-2 flex min-h-0 flex-1 items-center justify-center rounded-2xl border border-dashed bg-surface-muted xl:mt-0"
            :class="invalid ? 'border-red-500 dark:border-red-400' : 'border-line'"
        >
            <button
                type="button"
                class="rounded-xl border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink transition hover:border-brand/50 hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="mutationLocked"
                data-testid="empty-video-upload"
                @click="openFilePicker"
            >
                {{ t('workspace.video.choose') }}
            </button>
        </div>

        <div
            v-if="video"
            data-testid="video-material"
            role="group"
            :aria-label="video.fileName"
            class="flex min-w-0 flex-col"
            :class="
                compact
                    ? [
                        'mt-2 min-h-0 flex-1 gap-2 overflow-y-auto overscroll-contain rounded-2xl border border-dashed bg-surface-muted p-2 xl:mt-0',
                        invalid ? 'border-red-500 dark:border-red-400' : 'border-line',
                    ]
                    : stacked
                        ? 'gap-4'
                        : 'gap-4 rounded-xl border border-line bg-surface p-4 sm:flex-row sm:items-center'
            "
        >
            <button
                class="flex min-w-0 flex-1 flex-col items-center rounded-xl text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-default"
                :class="[
                    canPreviewVideo ? 'cursor-zoom-in hover:bg-surface-muted' : '',
                    stacked ? '' : 'sm:flex-row sm:text-left',
                    compact ? 'gap-2' : 'gap-4',
                ]"
                type="button"
                :disabled="!canPreviewVideo"
                :aria-label="
                    canPreviewVideo
                        ? t('workspace.video.preview', { name: video.fileName })
                        : undefined
                "
                @click="openVideoPreview"
            >
                <span class="relative flex h-14 w-14 shrink-0 items-center justify-center">
                    <svg
                        v-if="video.status === 'uploading'"
                        class="h-14 w-14 -rotate-90"
                        viewBox="0 0 44 44"
                        role="progressbar"
                        :aria-label="t('workspace.video.uploading')"
                        aria-valuemin="0"
                        aria-valuemax="100"
                        :aria-valuenow="video.uploadProgress"
                    >
                        <circle
                            cx="22"
                            cy="22"
                            r="18"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="4"
                            class="text-line"
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
                            :stroke-dashoffset="100 - video.uploadProgress"
                            class="text-brand transition-all duration-200"
                        />
                    </svg>
                    <span
                        v-else-if="video.status === 'queued' || video.status === 'processing'"
                        class="h-11 w-11 animate-spin rounded-full border-4 border-brand/20 border-t-brand"
                        role="status"
                        :aria-label="t('workspace.video.processing')"
                    ></span>
                    <span
                        v-else-if="video.status === 'upload_paused'"
                        class="flex h-11 w-11 items-center justify-center rounded-full bg-amber-100 text-lg font-bold text-amber-700 dark:bg-amber-400/15 dark:text-amber-200"
                        aria-hidden="true"
                    >
                        <AppIcon name="pause" size="lg" />
                    </span>
                    <span
                        v-else-if="video.status === 'ready'"
                        class="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500 text-xl text-white"
                        aria-hidden="true"
                    >
                        <AppIcon name="check" size="lg" />
                    </span>
                    <span
                        v-else
                        class="flex h-11 w-11 items-center justify-center rounded-full bg-red-100 text-xl text-red-600 dark:bg-red-400/15 dark:text-red-300"
                        aria-hidden="true"
                    >
                        <AppIcon name="warning" size="lg" />
                    </span>
                </span>

                <span class="w-full min-w-0 flex-1">
                    <span v-if="!compact" class="block truncate text-sm font-semibold text-ink">{{
                        video.fileName
                    }}</span>
                    <span v-if="!compact" class="mt-1 block text-xs text-muted">{{
                        formatFileSize(video.byteSize)
                    }}</span>
                    <span
                        v-if="statusLabel"
                        class="mt-1 block text-xs font-medium"
                        :class="statusColor"
                        role="status"
                    >
                        {{ statusLabel }}
                    </span>
                </span>
            </button>

            <div
                class="flex shrink-0 flex-wrap justify-center gap-2"
                :class="stacked ? '' : 'sm:justify-end'"
            >
                <button
                    v-if="video.status !== 'upload_paused'"
                    class="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-muted transition hover:border-brand/50 hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
                    type="button"
                    :disabled="operationPending || mutationLocked"
                    @click="openFilePicker"
                >
                    {{ t('workspace.video.replace') }}
                </button>
                <button
                    class="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-muted transition hover:border-red-300 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                    type="button"
                    :disabled="operationPending || mutationLocked"
                    @click="removeVideo"
                >
                    {{ t('workspace.video.remove') }}
                </button>
            </div>
        </div>
    </div>

    <AppConfirmDialog
        :open="confirmationOpen"
        :title="confirmationTitle"
        :description="confirmationDescription"
        :confirm-label="confirmationLabel"
        :cancel-label="t('common.cancel')"
        tone="danger"
        :busy="operationPending"
        @update:open="confirmationOpen = $event"
        @confirm="confirmVideoMutation"
        @cancel="cancelVideoMutation"
    />
    <AnalysisMediaPreviewDialog
        :open="Boolean(previewSource)"
        kind="video"
        :source="previewSource"
        :title="video?.fileName ?? ''"
        :close-label="t('common.close')"
        @update:open="closeVideoPreview"
    />
</template>
