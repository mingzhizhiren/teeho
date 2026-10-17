<script setup lang="ts">
import { computed, onBeforeUnmount, provide, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppConfirmDialog from '@/components/AppConfirmDialog.vue'
import InlineFeedback from '@/components/feedback/InlineFeedback.vue'
import { getFrontendRuntime } from '@/edition/runtime'
import { useOnboardingBlocker } from '@/features/onboarding/useOnboardingBlocker'
import { getApiRequestErrorMessage } from '@/utils/apiRequestError'
import AnalysisStorageCapacityDialog from './AnalysisStorageCapacityDialog.vue'
import type {
    AnalysisTask,
    AnalysisTaskConfig,
    StandardAnalysisTask,
    TaskFieldName,
    TaskFieldValue,
} from './analysis.contract'
import { analysisComposerKey, type AnalysisComposerContext } from './analysisComposer.context'
import { createDraftImageUpload } from './analysis.draft-image-upload'
import { browserAnalysisMediaTransport } from './analysis.media-upload.adapter'
import { browserAnalysisSubmissionAdapter } from './analysis.submission.adapter'
import { browserAnalysisVideoTransport } from './analysis.video-upload.adapter'
import { createAnalysisSubmissionFlow, type AnalysisSubmissionInput } from './analysis.submission'
import {
    resolveStorageSubmission,
    type InsufficientStorageChoice,
    type StorageCapacity,
} from './storageCapacity'
import { analysisMediaRequirement } from './analysis.media-requirement'
import type { NoteTemplateFields } from './analysis.note-template'
import { restoreReportDraft, type ReportEditSource } from './analysis.report-edit'
import { useAnalysisSubmissionIntentContext } from './useAnalysisSubmissionIntents'
import { useAnalysisFormPersistence } from './useAnalysisFormPersistence'
import {
    areDraftImagesReady,
    areDraftImagesUploaded,
    createEmptyTaskDraft,
    getDraftFieldIssue,
    hasEffectiveDraftContent,
    isDraftVideoReady,
    isDraftVideoUploaded,
    resolveDraftFieldForDisplay,
    setDraftContentKind,
    activeDraftImages,
    MISSING_COVER_PREFIX,
    type AnalysisContentKind,
    type SharedTaskImage,
    type SharedTaskVideo,
} from './taskDraft'

const props = defineProps<{
    taskConfig: AnalysisTaskConfig | null
    ownerUserId: string | null
    acceptSubmittedTask: (
        task: AnalysisTask,
        images: (File | null)[],
        persistHistory: boolean,
    ) => Promise<boolean>
}>()
const emit = defineEmits<{
    'manage-history': []
    'submission-state-change': [submitting: boolean]
    'session-content-change': [hasContent: boolean]
    'initialization-state-change': [state: 'loading' | 'ready' | 'error']
    'edit-error': [message: string]
}>()
const { t } = useI18n()
const runtime = getFrontendRuntime()
const access = runtime.useAnalysisAccess()
const draft = reactive(createEmptyTaskDraft())
const draftPreview = ref<StandardAnalysisTask | null>(null)
const previewing = ref(false)
const submitting = ref(false)
const checkingStorage = ref(false)
const formError = ref('')
const clearDraftConfirmationOpen = ref(false)
const editConfirmationOpen = ref(false)
const restoringReport = ref(false)
let reportEditRevision = 0
const editNotice = ref('')
let pendingEdit: { source: ReportEditSource; resolve: (edited: boolean) => void } | null = null
const draftAnalyticsRecorded = ref(false)
const draftRevision = ref(0)
let disposed = false
const capacityWarning = ref<Extract<StorageCapacity, { status: 'insufficient' }> | null>(null)
const busy = computed(
    () => previewing.value || submitting.value || checkingStorage.value || restoringReport.value,
)
const submissionIntents = useAnalysisSubmissionIntentContext()
const analysisSubmission = createAnalysisSubmissionFlow(
    browserAnalysisSubmissionAdapter,
    submissionIntents,
)
const persistence = useAnalysisFormPersistence({
    ownerUserId: () => props.ownerUserId,
    draft,
    draftPreview,
    busy,
    invalidate: () => analysisSubmission.invalidate(),
    report: (key) => {
        formError.value = t(key)
    },
})
const operationsLocked = computed(
    () =>
        !persistence.ready.value ||
        !persistence.healthy.value ||
        persistence.clearing.value ||
        busy.value,
)
const mediaRequirement = computed(() => analysisMediaRequirement(draft))
const mediaRequirementMessage = computed(() =>
    mediaRequirement.value.messageKey
        ? t(`workspace.mediaRequired.${mediaRequirement.value.messageKey}`)
        : '',
)
watch(mediaRequirementMessage, (message, previous) => {
    if (previous && formError.value === previous) formError.value = message
})
const accessLockMessage = computed(() => access.lockMessage)
const videoUnavailableMessage = computed(
    () =>
        access.videoBlockMessage(props.taskConfig) ||
        (!props.taskConfig?.uploads.videoEnabled
            ? t('workspace.contentKind.videoUnavailable')
            : ''),
)
const taskConfig = computed(() =>
    props.taskConfig
        ? {
              ...props.taskConfig,
              uploads: {
                  ...props.taskConfig.uploads,
                  videoEnabled: !videoUnavailableMessage.value,
              },
          }
        : null,
)
const VIDEO_COVER_IMAGE_COUNT = 1
const imageUploadLimits = computed(() => {
    const limits = taskConfig.value?.uploads
    if (!limits) return null
    return draft.contentKind === 'video'
        ? { ...limits, maxFiles: VIDEO_COVER_IMAGE_COUNT, maxTotalBytes: limits.maxFileBytes }
        : limits
})
const hasTaskSessionContent = computed(() =>
    Boolean(
        draft.rawText.trim() ||
        persistence.recoveredInput.value.trim() ||
        draft.images.length ||
        draft.video ||
        Object.entries(draft.fields).some(
            ([name, value]) =>
                name !== 'track' &&
                name !== 'customTrackName' &&
                (Array.isArray(value)
                    ? value.length
                    : value !== undefined && value !== null && String(value).trim()),
        ),
    ),
)
const canRequestAnalysis = computed(
    () =>
        Boolean(taskConfig.value) &&
        persistence.ready.value &&
        persistence.healthy.value &&
        !accessLockMessage.value &&
        hasEffectiveDraftContent(draft, taskConfig.value),
)
const canSubmit = computed(
    () =>
        canRequestAnalysis.value &&
        areDraftImagesUploaded(activeDraftImages(draft)) &&
        (draft.contentKind !== 'video' || !draft.video || isDraftVideoUploaded(draft.video)),
)
const accessInput = computed(() => ({
    config: taskConfig.value,
    contentKind: draft.contentKind,
    imageCount: activeDraftImages(draft).length,
    hasVideo: Boolean(draft.video),
}))
const submissionHint = computed(() => access.submissionHint(accessInput.value))
const coreDraftFieldNames = ['title', 'body', 'topics'] as const satisfies readonly TaskFieldName[]
const coreConfiguredFields = computed(() =>
    coreDraftFieldNames.flatMap((name) => {
        const field = taskConfig.value?.fields.find((candidate) => candidate.name === name)
        return field ? [field] : []
    }),
)
useOnboardingBlocker(
    computed(
        () =>
            clearDraftConfirmationOpen.value ||
            editConfirmationOpen.value ||
            capacityWarning.value !== null,
    ),
    'business_dialog',
)
watch(persistence.initializationState, (state) => emit('initialization-state-change', state), {
    immediate: true,
})
watch(hasTaskSessionContent, (hasContent) => emit('session-content-change', hasContent), {
    immediate: true,
})
watch(hasTaskSessionContent, (hasContent) => {
    if (!hasContent || draftAnalyticsRecorded.value || typeof draft.fields.track !== 'string')
        return
    runtime.onDraftStarted({
        inputMode: 'custom',
        contentKind: draft.contentKind,
        trackCode: draft.fields.track,
    })
    draftAnalyticsRecorded.value = true
})

/** 字段改变后保留原文，撤销旧准备凭据。 */
function invalidatePreview(): void {
    draftRevision.value += 1
    draftPreview.value = null
    analysisSubmission.invalidate()
}

function resolvedField(fieldName: TaskFieldName) {
    return resolveDraftFieldForDisplay(draft, fieldName, draftPreview.value)
}

function updateDraftField(fieldName: TaskFieldName, value: TaskFieldValue | undefined): void {
    if (operationsLocked.value) return
    const { [fieldName]: previous, ...fields } = draft.fields
    void previous
    draft.fields = value === undefined ? fields : { ...fields, [fieldName]: value }
    formError.value = ''
    invalidatePreview()
    void persistence.save()
}

/** 模板导入一次更新三项文字，保留全部素材及内容形态。 */
async function replaceNoteFields(fields: NoteTemplateFields): Promise<boolean> {
    if (operationsLocked.value) return false
    draft.fields = { ...draft.fields, ...fields, topics: [...fields.topics] }
    formError.value = ''
    invalidatePreview()
    return persistence.save()
}

/** 用户确认后才替换未提交内容；读取失败保留原草稿和原报告。 */
async function performReportEdit(source: ReportEditSource): Promise<boolean> {
    const ownerUserId = props.ownerUserId
    const revision = ++reportEditRevision
    const isCurrent = () => revision === reportEditRevision && ownerUserId === props.ownerUserId
    restoringReport.value = true
    try {
        const restored = await restoreReportDraft(source)
        if (!isCurrent()) return false
        Object.assign(draft, restored.draft)
        invalidatePreview()
        formError.value = ''
        editNotice.value =
            restored.missingImagePositions.length || restored.missingVideo
                ? t('workspace.edit.missingMedia', {
                      images: restored.missingImagePositions.join('、') || t('workspace.edit.none'),
                  })
                : ''
        await persistence.save()
        return isCurrent()
    } catch (error) {
        if (isCurrent())
            emit('edit-error', getApiRequestErrorMessage(error, t('workspace.edit.failed')))
        return false
    } finally {
        if (isCurrent()) restoringReport.value = false
    }
}

function requestReportEdit(source: ReportEditSource): Promise<boolean> {
    if (operationsLocked.value || pendingEdit) return Promise.resolve(false)
    if (!hasTaskSessionContent.value) return performReportEdit(source)
    editConfirmationOpen.value = true
    return new Promise((resolve) => {
        pendingEdit = { source, resolve }
    })
}

async function confirmReportEdit(): Promise<void> {
    const pending = pendingEdit
    if (!pending || restoringReport.value) return
    pending.resolve(await performReportEdit(pending.source))
    if (pendingEdit !== pending) return
    pendingEdit = null
    editConfirmationOpen.value = false
}

/** 用户切换上下文后取消当前恢复，迟到结果不能修改草稿或后续确认。 */
function cancelReportEdit(): void {
    reportEditRevision += 1
    restoringReport.value = false
    editConfirmationOpen.value = false
    pendingEdit?.resolve(false)
    pendingEdit = null
}

watch(
    () => props.ownerUserId,
    () => {
        editNotice.value = ''
        clearDraftConfirmationOpen.value = false
        cancelReportEdit()
    },
    { flush: 'sync' },
)

const draftImageUpload = createDraftImageUpload(
    {
        read: () => draft.images,
        update: updateDraftImages,
        rateLimited: clearDraftMediaAfterUploadLimit,
    },
    browserAnalysisMediaTransport,
)

function updateDraftImages(images: SharedTaskImage[]): void {
    const selectionChanged =
        images.length !== draft.images.length ||
        images.some((image, index) => image.localId !== draft.images[index]?.localId)
    const previousIds = new Set(draft.images.map((image) => image.localId))
    const wasMissingCover = draft.coverLocalId?.startsWith(MISSING_COVER_PREFIX)
    draft.images = [...images]
    if (!images.some((image) => image.localId === draft.coverLocalId)) {
        draft.coverLocalId = wasMissingCover
            ? (images.find((image) => !previousIds.has(image.localId))?.localId ??
              draft.coverLocalId)
            : (images[0]?.localId ?? null)
    }
    // 上传进度及处理轮询不是用户编辑，不清除仍然有效的表单错误。
    if (selectionChanged) formError.value = ''
    invalidatePreview()
    void persistence.save()
}

function updateDraftCover(localId: string): void {
    if (
        operationsLocked.value ||
        !draft.images.some((image) => image.localId === localId) ||
        draft.coverLocalId === localId
    )
        return
    draft.coverLocalId = localId
    formError.value = ''
    invalidatePreview()
    void persistence.save()
}

/** 图文和视频切换复用同一草稿，保留两类已上传素材。 */
async function updateContentKind(contentKind: AnalysisContentKind): Promise<void> {
    if (operationsLocked.value || draft.contentKind === contentKind) return
    if (contentKind === 'video' && videoUnavailableMessage.value) {
        formError.value = videoUnavailableMessage.value
        return
    }
    setDraftContentKind(draft, contentKind)
    formError.value = ''
    invalidatePreview()
    await persistence.save()
}

function updateDraftVideo(video: SharedTaskVideo | null): void {
    const selectionChanged = (video?.localId ?? null) !== (draft.video?.localId ?? null)
    draft.video = video ? { ...video } : null
    if (selectionChanged) formError.value = ''
    invalidatePreview()
    void persistence.save()
}

function clearDraftMediaAfterUploadLimit(): void {
    draft.images = []
    draft.coverLocalId = null
    draft.video = null
    formError.value = t('workspace.upload.rateLimited')
    invalidatePreview()
    void persistence.save()
}

function requestClearDraft(): void {
    if (operationsLocked.value || !hasTaskSessionContent.value) return
    clearDraftConfirmationOpen.value = true
}

async function confirmClearDraft(): Promise<void> {
    if (operationsLocked.value || !clearDraftConfirmationOpen.value) return
    const ownerUserId = props.ownerUserId
    const videoId = draft.video?.origin === 'report' ? null : draft.video?.videoId
    if (!(await persistence.clear())) return
    if (ownerUserId !== props.ownerUserId) return
    clearDraftConfirmationOpen.value = false
    draftAnalyticsRecorded.value = false
    editNotice.value = ''
    formError.value = ''
    if (videoId) {
        try {
            await browserAnalysisVideoTransport.cancel(videoId)
        } catch {
            if (ownerUserId === props.ownerUserId)
                formError.value = t('workspace.formDraft.mediaCleanupFailed')
        }
    }
}

/** 残留草稿必须与已结束任务的文字和全部素材身份一致才能清理。 */
async function discardCompletedTaskDraft(completedTask: AnalysisTask): Promise<boolean> {
    if (operationsLocked.value || !hasTaskSessionContent.value) return false
    const preview = draftPreview.value
    const standard = completedTask.standardTask
    if (
        !preview ||
        preview.contentKind !== standard.contentKind ||
        preview.rawText !== standard.rawText ||
        preview.coverReference !== standard.coverReference ||
        JSON.stringify(preview.imageReferences) !== JSON.stringify(standard.imageReferences) ||
        JSON.stringify(preview.fields) !== JSON.stringify(standard.fields) ||
        JSON.stringify(preview.videoEvidence) !== JSON.stringify(standard.videoEvidence)
    )
        return false
    return persistence.clear('submitted')
}

function validateRequiredDraftFields(): boolean {
    const config = taskConfig.value
    if (!config) return false
    if (mediaRequirementMessage.value) {
        formError.value = mediaRequirementMessage.value
        return false
    }
    const issue = getDraftFieldIssue(draft, config)
    if (!issue) return true
    formError.value = t(`workspace.checkupInput.${issue.reason}`, {
        field: t(issue.field.labelKey),
        limit: issue.limit,
    })
    return false
}

function currentSubmissionInput(config: AnalysisTaskConfig): AnalysisSubmissionInput {
    const ownerUserId = props.ownerUserId
    return {
        deferMediaPreparation: true,
        isCurrent: () => !disposed && ownerUserId !== null && ownerUserId === props.ownerUserId,
        draft,
        mode: 'custom',
        confirmationRevision: draftRevision.value,
        conversationSession: null,
        timeoutMs: config.runtime.preparationRequestTimeoutMs,
    }
}

function reportError(error: unknown): void {
    formError.value = getApiRequestErrorMessage(error, t('workspace.genericError'))
}

async function previewDraft(): Promise<boolean> {
    const config = taskConfig.value
    if (operationsLocked.value || !canSubmit.value || !config || !validateRequiredDraftFields())
        return false
    if (
        !areDraftImagesReady(activeDraftImages(draft)) ||
        (draft.contentKind === 'video' && !isDraftVideoReady(draft.video))
    ) {
        formError.value = t('workspace.mediaRequired.previewPreparing')
        return false
    }
    const input = currentSubmissionInput(config)
    formError.value = ''
    previewing.value = true
    try {
        const outcome = await analysisSubmission.preview(input)
        if (!input.isCurrent?.()) return false
        draftPreview.value = outcome.standardTask
        if (outcome.acceptance.status !== 'accepted')
            formError.value = outcome.acceptance.message ?? ''
        await persistence.save()
        return outcome.acceptance.status === 'accepted'
    } catch (error) {
        if (input.isCurrent?.()) reportError(error)
        return false
    } finally {
        if (input.isCurrent?.()) previewing.value = false
    }
}

async function submitDraft(): Promise<void> {
    const config = taskConfig.value
    if (operationsLocked.value || !config) return
    if (accessLockMessage.value) {
        formError.value = accessLockMessage.value
        return
    }
    if (!validateRequiredDraftFields() || !canRequestAnalysis.value || !canSubmit.value) return
    formError.value = ''
    const input = currentSubmissionInput(config)
    checkingStorage.value = true
    try {
        const readiness = await analysisSubmission.assess(input)
        if (!input.isCurrent?.()) return
        if (readiness.kind === 'storage_warning') {
            capacityWarning.value = readiness.capacity
            return
        }
        checkingStorage.value = false
        await submitDraftWithPersistence(readiness.persistHistory)
    } catch (error) {
        if (input.isCurrent?.()) reportError(error)
    } finally {
        if (input.isCurrent?.()) checkingStorage.value = false
    }
}

function chooseStorageAction(choice: InsufficientStorageChoice): void {
    const warning = capacityWarning.value
    capacityWarning.value = null
    if (!warning) return
    const decision = resolveStorageSubmission(warning, choice)
    if (decision.action === 'manage_history') emit('manage-history')
    if (decision.action === 'submit') void submitDraftWithPersistence(decision.persistHistory)
}

async function submitDraftWithPersistence(persistHistory: boolean): Promise<void> {
    const config = taskConfig.value
    if (
        !canRequestAnalysis.value ||
        previewing.value ||
        submitting.value ||
        !config ||
        !validateRequiredDraftFields() ||
        !canSubmit.value
    )
        return
    formError.value = ''
    const input = currentSubmissionInput(config)
    submitting.value = true
    emit('submission-state-change', true)
    try {
        const historyImages = persistHistory
            ? await persistence.readImages(activeDraftImages(draft))
            : []
        if (!input.isCurrent?.()) return
        await access.refresh()
        if (!input.isCurrent?.()) return
        const blocked = access.submissionBlockMessage(accessInput.value)
        if (blocked) {
            formError.value = blocked
            return
        }
        const submission = await analysisSubmission.submit(input, persistHistory)
        if (!input.isCurrent?.()) return
        if (!submission.task) {
            formError.value = submission.acceptance.message ?? t('workspace.genericError')
            return
        }
        const historySaved = await props.acceptSubmittedTask(
            submission.task,
            historyImages,
            persistHistory,
        )
        if (!input.isCurrent?.()) return
        if (!persistHistory || historySaved) await persistence.clear('submitted')
        draftAnalyticsRecorded.value = false
    } catch (error) {
        if (input.isCurrent?.()) reportError(error)
    } finally {
        if (input.isCurrent?.()) {
            emit('submission-state-change', false)
            submitting.value = false
        }
    }
}

const context: AnalysisComposerContext = {
    recoveredInput: persistence.recoveredInput,
    operationsLocked,
    taskConfig,
    imageUploadLimits,
    videoUnavailableMessage,
    draft,
    mediaRequirement,
    mediaRequirementMessage,
    draftPreview,
    previewing,
    submitting,
    checkingStorage,
    formError,
    editNotice,
    canRequestAnalysis,
    canSubmit,
    submissionHint,
    coreConfiguredFields,
    resolvedField,
    updateDraftField,
    replaceNoteFields,
    updateContentKind,
    updateDraftImages,
    uploadDraftImages: draftImageUpload.upload,
    retryDraftImage: draftImageUpload.retry,
    updateDraftCover,
    updateDraftVideo,
    clearDraftMediaAfterUploadLimit,
    previewDraft,
    submitDraft,
}
provide(analysisComposerKey, context)
defineExpose({
    requestClearDraft,
    discardCompletedTaskDraft,
    requestReportEdit,
    cancelReportEdit,
    operationsLocked,
})
onBeforeUnmount(() => {
    disposed = true
    draftImageUpload.dispose()
    cancelReportEdit()
})
</script>

<template>
    <div class="flex min-h-0 min-w-0 flex-col gap-3">
        <InlineFeedback
            v-if="accessLockMessage"
            class="shrink-0"
            :feedback="{
                key: 'analysis.access-lock',
                scope: 'module',
                tone: 'warning',
                message: accessLockMessage,
            }"
        />
        <slot />
        <AnalysisStorageCapacityDialog :warning="capacityWarning" @choose="chooseStorageAction" />
        <AppConfirmDialog
            v-model:open="editConfirmationOpen"
            :title="t('workspace.edit.confirmTitle')"
            :description="t('workspace.edit.confirmDescription')"
            :confirm-label="t('workspace.edit.confirmAction')"
            :cancel-label="t('common.cancel')"
            :busy="restoringReport"
            @confirm="confirmReportEdit"
            @cancel="cancelReportEdit"
        />
        <AppConfirmDialog
            v-model:open="clearDraftConfirmationOpen"
            :title="t('workspace.formDraft.clearConfirmTitle')"
            :description="t('workspace.formDraft.clearConfirmDescription')"
            :confirm-label="t('workspace.formDraft.clearConfirmAction')"
            :cancel-label="t('common.cancel')"
            tone="danger"
            :busy="persistence.clearing.value"
            @confirm="confirmClearDraft"
        />
    </div>
</template>
