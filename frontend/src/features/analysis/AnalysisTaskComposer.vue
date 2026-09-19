<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, provide, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUserStorage } from '@/composables/useUserStorage'
import {
    acknowledgeAnalysisConversationTurn,
    clearAnalysisConversation,
    formAnalysisConversationTurn,
    getAnalysisConversationControl,
    recoverAnalysisConversationTurn,
} from '@/api/analysis'

import { TIME_MS } from '@/config/constants'
import AppConfirmDialog from '@/components/AppConfirmDialog.vue'
import InlineFeedback from '@/components/feedback/InlineFeedback.vue'
import ToastMessage from '@/components/ToastMessage.vue'
import { getFrontendRuntime } from '@/edition/runtime'
import { getApiRequestErrorMessage } from '@/utils/apiRequestError'
import { useWorkspaceEventsStore } from '@/stores/workspaceEvents'
import { useOnboardingCoordinator } from '@/features/onboarding/onboarding.context'
import { isOnboardingChapterTargetAvailable } from '@/features/onboarding/onboarding.targets'
import { useOnboardingBlocker } from '@/features/onboarding/useOnboardingBlocker'
import AnalysisStorageCapacityDialog from './AnalysisStorageCapacityDialog.vue'
import { formatTaskFieldValue } from './analysis.format'
import { createAnalysisOnboardingEventReporter } from './analysis.onboarding'
import type {
    AnalysisInputMode,
    AnalysisTask,
    AnalysisTaskConfig,
    StandardAnalysisTask,
    TaskFieldDefinition,
    TaskFieldName,
    TaskFieldValue,
} from './analysis.contract'
import {
    analysisComposerKey,
    type AgentChatMessage,
    type AnalysisComposerContext,
} from './analysisComposer.context'
import { analysisUiConstraints } from './analysis.constants'
import { createDraftImageUpload } from './analysis.draft-image-upload'
import { browserAnalysisMediaTransport } from './analysis.media-upload.adapter'
import { formatAgentCooldownDuration, resolveDraftSendCooldown } from './draftSendCooldown'
import {
    commitConversationTurn,
    createConversationState,
    createConversationTurnRequest,
    materializeConversationDraft,
    type AnalysisConversationPendingTurn,
    type AnalysisRollingUsage,
    type AnalysisConversationState,
    type AnalysisConversationTurnResult,
} from './analysis.conversation'
import {
    createFreshConversationSession,
    reconcileConversationAuthority,
} from './analysis.conversation-authority'
import {
    AnalysisConversationPersistenceError,
    type AnalysisConversationPersistence,
    type AnalysisConversationRestoreResult,
    type AnalysisFormingConversationSnapshot,
} from './analysis.conversation-persistence'
import { createBrowserAnalysisConversationPersistence } from './analysis.conversation-persistence.browser'
import {
    createAgentPresentationSelector,
    presentAgentConversationTurn,
} from './analysis.agent-presentation'
import {
    confirmDraftRevision,
    createDraftRevisionState,
    invalidateDraftRevision,
    isDraftRevisionConfirmed,
    sessionHasUserContent,
} from './analysis.forming-session'
import { persistedTrackSelectionSchema, trackSelectionStorageKey } from './analysis.track-selection'
import { browserAnalysisSubmissionAdapter } from './analysis.submission.adapter'
import { reconcileRestoredDraftVideo } from './analysis.video-upload'
import { browserAnalysisVideoTransport } from './analysis.video-upload.adapter'
import { browserVideoEvidenceTransferClient } from './analysis.video-evidence.browser'
import { createAnalysisSubmissionFlow, type AnalysisSubmissionInput } from './analysis.submission'
import {
    estimateBrowserStorageCapacity,
    resolveStorageSubmission,
    type InsufficientStorageChoice,
    type StorageCapacity,
} from './storageCapacity'
import {
    LocalVideoEvidenceError,
    LocalVideoEvidenceManager,
    preserveVideoEvidenceLocally,
} from './localVideoEvidence'
import { analysisMediaRequirement } from './analysis.media-requirement'
import { useAnalysisSubmissionIntentContext } from './useAnalysisSubmissionIntents'
import {
    areDraftImagesReady,
    createEmptyTaskDraft,
    createDraftPayload,
    getDraftFieldIssue,
    hasEffectiveDraftContent,
    isDraftVideoReady,
    resolveDraftFieldForDisplay,
    setDraftContentKind,
    activeDraftImages,
    type AnalysisContentKind,
    type SharedTaskImage,
    type SharedTaskVideo,
} from './taskDraft'

const props = defineProps<{
    mode: AnalysisInputMode
    taskConfig: AnalysisTaskConfig | null
    ownerUserId: string | null
    acceptSubmittedTask: (
        task: AnalysisTask,
        images: File[],
        persistHistory: boolean,
    ) => Promise<boolean>
}>()
const emit = defineEmits<{
    'manage-history': []
    'submission-state-change': [submitting: boolean]
    'session-content-change': [hasContent: boolean]
    'initialization-state-change': [state: 'loading' | 'ready' | 'error']
}>()
const { t, locale } = useI18n()
const runtime = getFrontendRuntime()
const access = runtime.useAnalysisAccess()
const workspaceEvents = useWorkspaceEventsStore()
const userStorage = useUserStorage()
const onboardingCoordinator = useOnboardingCoordinator()
const onboardingEventReporter = createAnalysisOnboardingEventReporter(onboardingCoordinator)
const draft = reactive(createEmptyTaskDraft())
const mediaRequirement = computed(() => analysisMediaRequirement(draft))
const mediaRequirementMessage = computed(() =>
    mediaRequirement.value.messageKey
        ? t(`workspace.mediaRequired.${mediaRequirement.value.messageKey}`)
        : '',
)
const mediaSubmitToast = ref('')
let mediaSubmitToastTimer: ReturnType<typeof setTimeout> | null = null
watch(mediaRequirementMessage, () => {
    mediaSubmitToast.value = ''
    if (mediaSubmitToastTimer !== null) clearTimeout(mediaSubmitToastTimer)
    mediaSubmitToastTimer = null
})
const draftAnalyticsRecorded = ref(false)
const draftPreview = ref<StandardAnalysisTask | null>(null)
const draftPreparationId = ref<string | null>(null)
const previewing = ref(false)
const submitting = ref(false)
const checkingStorage = ref(false)
const formError = ref('')
const agentMessages = ref<AgentChatMessage[]>([])
const agentComposerText = ref('')
const agentTyping = ref(false)
const hasAgentReplyContext = ref(false)
const agentConfirmationVisible = ref(false)
const confirmationRevision = reactive(createDraftRevisionState())
const clearConversationConfirmationOpen = ref(false)
const pendingNewTaskContentKind = ref<AnalysisContentKind | null>(null)
const conversationState = ref<AnalysisConversationState | null>(null)
const pendingConversationTurn = ref<AnalysisConversationPendingTurn | null>(null)
const conversationExpiredToastVisible = ref(false)
const trackLocked = ref(false)
const trackSelectionLoaded = ref(false)
const conversationPersistenceReady = ref(false)
const conversationPersistenceHealthy = ref(true)
const conversationInitializationFailed = ref(false)
const conversationAuthorityPending = ref(false)
const conversationRecoveryPending = ref(false)
const localConversationVisible = ref(false)
const operationsLocked = computed(
    () =>
        !conversationPersistenceReady.value ||
        !conversationPersistenceHealthy.value ||
        conversationAuthorityPending.value ||
        conversationRecoveryPending.value ||
        pendingConversationTurn.value !== null ||
        previewing.value ||
        submitting.value ||
        checkingStorage.value,
)
const conversationSyncMessage = computed(() => {
    if (!localConversationVisible.value) return ''
    if (conversationInitializationFailed.value) return t('workspace.agentChat.syncRetrying')
    return !conversationPersistenceReady.value || conversationRecoveryPending.value
        ? t('workspace.agentChat.syncing')
        : ''
})
const draftCooldownRemainingSeconds = ref(0)
const capacityWarning = ref<Extract<StorageCapacity, { status: 'insufficient' }> | null>(null)
const taskComposerDialogOpen = computed(
    () => clearConversationConfirmationOpen.value || capacityWarning.value !== null,
)
useOnboardingBlocker(taskComposerDialogOpen, 'business_dialog')
let agentReplyPresentationGeneration = 0
let pendingNewConfirmationOnboarding = false
const submissionIntents = useAnalysisSubmissionIntentContext()
const analysisSubmission = createAnalysisSubmissionFlow(
    browserAnalysisSubmissionAdapter,
    submissionIntents,
)
const mode = computed(() => props.mode)
const agentInteractionMode = computed(() => 'conversation' as const)
const initializationState = computed<'loading' | 'ready' | 'error'>(() => {
    if (!trackSelectionLoaded.value) return 'loading'
    if (localConversationVisible.value) return 'ready'
    if (!conversationPersistenceHealthy.value || conversationInitializationFailed.value) {
        return 'error'
    }
    if (!conversationPersistenceReady.value || conversationRecoveryPending.value) {
        return 'loading'
    }
    return 'ready'
})
const conversationTokenBudget = computed(() => {
    const settled = conversationState.value?.tokenBudget
    if (settled) return settled
    const policy = access.initialTokenBudget
    if (!policy || policy.sessionTokenBudget === null) return null
    return {
        normalTokenBudget: policy.sessionTokenBudget,
        finalDraftTokenReserve: policy.finalDraftTokenReserve,
        consumedTokens: 0,
        percentage: 0,
        tone: 'green' as const,
        exhausted: false,
        thresholds: { ...policy.sessionProgressThresholds },
    }
})
const agentSendAvailable = computed(
    () =>
        draftCooldownRemainingSeconds.value === 0 &&
        !conversationTokenBudget.value?.exhausted &&
        conversationPersistenceReady.value &&
        conversationPersistenceHealthy.value,
)
const videoUnavailableMessage = computed(() => {
    const config = props.taskConfig
    return (
        access.videoBlockMessage(config) ||
        (!config?.uploads.videoEnabled ? t('workspace.contentKind.videoUnavailable') : '')
    )
})
const taskConfig = computed(() => {
    if (!props.taskConfig) return null
    return {
        ...props.taskConfig,
        uploads: {
            ...props.taskConfig.uploads,
            videoEnabled: !videoUnavailableMessage.value,
        },
    }
})
const VIDEO_COVER_IMAGE_COUNT = 1
const imageUploadLimits = computed(() => {
    const limits = taskConfig.value?.uploads
    if (!limits) return null
    return draft.contentKind === 'video'
        ? { ...limits, maxFiles: VIDEO_COVER_IMAGE_COUNT, maxTotalBytes: limits.maxFileBytes }
        : limits
})
const accessLockMessage = computed(() => access.lockMessage)
const selectedTrackId = computed(() => {
    const value = draft.fields.track
    return typeof value === 'string' ? value : null
})
const selectedCustomTrackName = computed(() => {
    const value = draft.fields.customTrackName
    return typeof value === 'string' ? value : null
})
const selectedTrackLabel = computed(() => {
    const track = taskConfig.value?.tracks.find(
        (candidate) => candidate.id === selectedTrackId.value,
    )
    if (!track) return null
    if (!track.custom) return t(track.labelKey)
    return selectedCustomTrackName.value?.trim() || null
})
const canRequestAnalysis = computed(() => {
    const hasContent =
        hasEffectiveDraftContent(draft, taskConfig.value) ||
        (mode.value === 'agent' && Boolean(agentComposerText.value.trim()))
    return (
        Boolean(taskConfig.value) &&
        !conversationRecoveryPending.value &&
        pendingConversationTurn.value === null &&
        (!localConversationVisible.value || conversationPersistenceReady.value) &&
        (mode.value !== 'agent' ||
            (conversationPersistenceReady.value && conversationPersistenceHealthy.value)) &&
        !accessLockMessage.value &&
        hasContent
    )
})
const canSubmit = computed(() => {
    return (
        canRequestAnalysis.value &&
        areDraftImagesReady(activeDraftImages(draft)) &&
        (draft.contentKind !== 'video' || !draft.video || isDraftVideoReady(draft.video))
    )
})

watch(
    () => ({
        hasContent: hasEffectiveDraftContent(draft, taskConfig.value),
        inputMode: mode.value,
        contentKind: draft.contentKind,
        trackCode: selectedTrackId.value,
    }),
    (state) => {
        if (draftAnalyticsRecorded.value || !state.hasContent || !state.trackCode) return
        runtime.onDraftStarted({
            inputMode: state.inputMode,
            contentKind: state.contentKind,
            trackCode: state.trackCode,
        })
        draftAnalyticsRecorded.value = true
    },
)

/** 在正式体检前指出缺少或超出上限的笔记字段，保留草稿供用户修正。 */
function validateRequiredDraftFields(): boolean {
    const config = taskConfig.value
    if (!config) return false
    if (draft.contentKind === 'image' && !draft.images.some((image) => Boolean(image.assetId))) {
        formError.value = t('skillAuth.missingCover')
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
const accessInput = computed(() => ({
    config: taskConfig.value,
    contentKind: draft.contentKind,
    imageCount: activeDraftImages(draft).length,
    hasVideo: Boolean(draft.video),
}))
const submissionHint = computed(() => access.submissionHint(accessInput.value))
const submissionActionLabel = computed(
    () =>
        runtime.analysisText('submit', { input: accessInput.value }) ??
        t('workspace.agentChat.confirmStart'),
)
const accessBlockMessage = computed(() => access.submissionBlockMessage(accessInput.value))
const visibleConfiguredFields = computed(() => {
    return (
        taskConfig.value?.fields
            .filter((field) => {
                if (field.name === 'track' || field.name === 'customTrackName') {
                    return false
                }
                if (!field.visibleWhen) {
                    return true
                }
                return effectiveFieldValue(field.visibleWhen.field) === field.visibleWhen.equals
            })
            .sort((left, right) => left.order - right.order) ?? []
    )
})
const confirmationConfiguredFields = computed(() =>
    (taskConfig.value?.fields ?? [])
        .filter(
            (field) =>
                !field.visibleWhen ||
                effectiveFieldValue(field.visibleWhen.field) === field.visibleWhen.equals,
        )
        .sort((left, right) => left.order - right.order),
)
const coreDraftFieldNames = ['title', 'body', 'topics'] as const satisfies readonly TaskFieldName[]
const coreConfiguredFields = computed(() => {
    const fields = new Map(confirmationConfiguredFields.value.map((field) => [field.name, field]))
    return coreDraftFieldNames.flatMap((name) => {
        const field = fields.get(name)
        return field ? [field] : []
    })
})
const secondaryConfiguredFields = computed(() => {
    const core = new Set<TaskFieldName>(coreDraftFieldNames)
    return confirmationConfiguredFields.value.filter((field) => !core.has(field.name))
})
const agentConfirmationCurrent = computed(
    () =>
        agentConfirmationVisible.value &&
        !pendingConversationTurn.value &&
        !previewing.value &&
        Boolean(draftPreview.value || conversationState.value) &&
        isDraftRevisionConfirmed(confirmationRevision),
)
const hasTaskSessionContent = computed(() =>
    sessionHasUserContent({
        rawText: draft.rawText,
        nonTrackFieldCount: Object.keys(draft.fields).filter(
            (name) => name !== 'track' && name !== 'customTrackName',
        ).length,
        userMessageCount: agentMessages.value.filter((message) => message.role === 'user').length,
        imageCount: draft.images.length,
        videoPresent: Boolean(draft.video),
    }),
)
let agentMessageId = 0
let typingGeneration = 0
let activeTypingMessage: { message: AgentChatMessage; fullText: string } | null = null
let conversationTurnGeneration = 0
let draftCooldownTimer: number | null = null
let conversationExpiredToastTimer: number | null = null
let conversationExpiryTimer: number | null = null
let conversationExpiryPending = false
let conversationExpirationRunning = false
let conversationRecoveryGeneration = 0
let activeConversationRecoveryGeneration: number | null = null
const conversationRecoveryWaiters = new Map<number, () => void>()
let pendingExpiredCleanup: ExpiredConversationCleanup = null
let pendingExpirationLocalAlreadyCleared = false
let trackRestoreGeneration = 0
let conversationPersistenceGeneration = 0
let conversationPersistence: AnalysisConversationPersistence | null = null
let conversationPersistenceOwner: string | null = null
let conversationPersistenceWrite: Promise<void> = Promise.resolve()
let conversationPersistenceRetryPending = false
let applyingPersistedConversation = false
let authorityReconciliationActive = false
let authorityReconciliationPending = false
let agentTurnLockNotice: string | null = null
let activeFreshAuthorityPreflight: {
    persistence: AnalysisConversationPersistence
    promise: Promise<void>
} | null = null
let conversationSession: AnalysisFormingConversationSnapshot['session'] = {
    sessionId: crypto.randomUUID(),
    generation: 1,
    browserInstanceId: crypto.randomUUID(),
}
let conversationSessionInitialized = false
let conversationSessionAuthorityReady = false
let agentPresentationSelector = createAgentPresentationSelector(
    locale.value === 'en-US' ? 'en-US' : 'zh-CN',
)

watch(locale, (value) => {
    agentPresentationSelector = createAgentPresentationSelector(
        value === 'en-US' ? 'en-US' : 'zh-CN',
    )
})

watch(initializationState, (state) => emit('initialization-state-change', state), {
    immediate: true,
})

/** 恢复当前账号在本浏览器最后一次明确选择的赛道。 */
async function restoreTrackSelection(userId: string | null, config: AnalysisTaskConfig | null) {
    const generation = ++trackRestoreGeneration
    trackSelectionLoaded.value = false
    trackLocked.value = false
    delete draft.fields.track
    delete draft.fields.customTrackName
    if (!userId || !config) return

    try {
        const saved = await userStorage.getValue(
            trackSelectionStorageKey,
            persistedTrackSelectionSchema,
        )
        if (generation !== trackRestoreGeneration) return
        const track = config.tracks.find((candidate) => candidate.id === saved?.trackId)
        if (track) {
            draft.fields.track = track.id
            if (track.custom && saved?.customTrackName) {
                draft.fields.customTrackName = saved.customTrackName
            }
        }
    } catch {
        // 无效、损坏或不可读的本地选择按首次选择处理。
    } finally {
        if (generation === trackRestoreGeneration) trackSelectionLoaded.value = true
    }
}

watch(
    [() => props.ownerUserId, () => taskConfig.value?.version ?? null],
    ([userId]) => void restoreTrackSelection(userId, taskConfig.value),
    { immediate: true },
)

watch(hasTaskSessionContent, (hasContent) => emit('session-content-change', hasContent), {
    immediate: true,
})

/** 保存账号隔离的赛道选择；存储失败不阻止当前页面继续形成任务。 */
async function persistTrackSelection() {
    const trackId = selectedTrackId.value
    if (!props.ownerUserId || !trackId) return
    try {
        await userStorage.setValue(trackSelectionStorageKey, {
            trackId,
            customTrackName:
                trackId === 'custom' ? (selectedCustomTrackName.value?.trim() ?? null) : null,
        })
    } catch {
        // 当前会话中的显式选择仍然有效。
    }
}

/** 更新用户显式赛道；首轮受理后拒绝任何页面或 Agent 改写。 */
function updateTrackSelection(trackId: string | null) {
    if (trackLocked.value) return
    const track = taskConfig.value?.tracks.find((candidate) => candidate.id === trackId)
    if (!track) {
        delete draft.fields.track
        delete draft.fields.customTrackName
    } else {
        draft.fields.track = track.id
        if (!track.custom) delete draft.fields.customTrackName
    }
    invalidatePreview()
    void persistTrackSelection()
}

function updateCustomTrackName(name: string | null) {
    if (trackLocked.value || selectedTrackId.value !== 'custom') return
    if (name?.trim()) draft.fields.customTrackName = name.trim()
    else delete draft.fields.customTrackName
    invalidatePreview()
    void persistTrackSelection()
}

/** 创建不含预设文案的账号会话快照；未成功受理的输入不会成为语义历史。 */
function currentConversationSnapshot(
    pendingComposerText = agentComposerText.value,
    confirmationVisible = agentConfirmationVisible.value,
): AnalysisFormingConversationSnapshot {
    const hasAcceptedMessage = Boolean(
        conversationState.value?.history.some((message) => message.role === 'user'),
    )
    return {
        session: conversationSession,
        pendingComposerText,
        pendingTurn: pendingConversationTurn.value,
        draft: {
            contentKind: draft.contentKind,
            rawText: hasAcceptedMessage ? draft.rawText : '',
            fields: { ...draft.fields },
            images: [...draft.images],
            coverLocalId: draft.coverLocalId ?? null,
            video: draft.video ? { ...draft.video } : null,
        },
        conversationState: conversationState.value,
        draftPreview: draftPreview.value,
        preparationId: draftPreparationId.value,
        confirmation: {
            currentRevision: confirmationRevision.currentRevision,
            confirmedRevision: confirmationRevision.confirmedRevision,
            visible: confirmationVisible,
        },
        trackLocked: trackLocked.value,
    }
}

/** 存储异常后关闭真实发送，避免后续把损坏或无法镜像的上下文交给 Agent。 */
function failConversationPersistence(notifyPeers = true, error?: unknown) {
    if (!conversationPersistenceHealthy.value) return
    conversationPersistenceHealthy.value = false
    formError.value = t(
        error instanceof AnalysisConversationPersistenceError && error.code === 'quota_exceeded'
            ? 'workspace.agentChat.localStorageFull'
            : 'workspace.agentChat.localConversationUnavailable',
    )
    if (notifyPeers) conversationPersistence?.notifyUnavailable()
}

/** 串行写入最新快照，避免上传状态和 Agent 结果交错覆盖。 */
function persistCurrentConversation(
    options: { confirmationVisible?: boolean } = {},
): Promise<boolean> {
    const persistence = conversationPersistence
    if (!persistence || !conversationPersistenceHealthy.value || applyingPersistedConversation) {
        return Promise.resolve(false)
    }
    if (!conversationPersistenceReady.value) {
        conversationPersistenceRetryPending = true
        return Promise.resolve(false)
    }
    const snapshot = currentConversationSnapshot(
        agentComposerText.value,
        options.confirmationVisible ?? agentConfirmationVisible.value,
    )
    const write = persistence
        .save(snapshot)
        .then((saved) => {
            scheduleConversationExpiry(saved.expiresAt)
            conversationPersistenceRetryPending = false
            return true
        })
        .catch((error: unknown) => {
            failConversationPersistence(true, error)
            return false
        })
    conversationPersistenceWrite = write.then(() => undefined)
    return write
}

function appendRestoredMessage(
    role: AgentChatMessage['role'],
    text: string,
    kind?: AgentChatMessage['kind'],
) {
    agentMessages.value.push({
        id: ++agentMessageId,
        role,
        text,
        typing: false,
        kind,
    })
}

function showConversationExpiredToast() {
    conversationExpiredToastVisible.value = true
    if (conversationExpiredToastTimer !== null) {
        window.clearTimeout(conversationExpiredToastTimer)
    }
    conversationExpiredToastTimer = window.setTimeout(() => {
        conversationExpiredToastVisible.value = false
        conversationExpiredToastTimer = null
    }, analysisUiConstraints.actionToastDurationMs)
}

function clearConversationExpiryTimer() {
    if (conversationExpiryTimer !== null) {
        window.clearTimeout(conversationExpiryTimer)
        conversationExpiryTimer = null
    }
}

function scheduleConversationExpiry(expiresAt: string) {
    clearConversationExpiryTimer()
    const remainingMs = Date.parse(expiresAt) - Date.now()
    if (remainingMs <= 0) {
        void expireCurrentConversation()
        return
    }
    conversationExpiryTimer = window.setTimeout(() => {
        conversationExpiryTimer = null
        void expireCurrentConversation()
    }, remainingMs)
}

type ExpiredConversationCleanup = Extract<
    AnalysisConversationRestoreResult,
    { status: 'expired' }
>['cleanup']

/** 到期清空以本地不可复活为准；服务端会话和视频随后尽力收尾。 */
async function expireCurrentConversation(
    cleanup: ExpiredConversationCleanup = null,
    localAlreadyCleared = false,
) {
    if (conversationExpirationRunning) return
    if (
        previewing.value ||
        conversationAuthorityPending.value ||
        submitting.value ||
        checkingStorage.value
    ) {
        conversationExpiryPending = true
        pendingExpiredCleanup = cleanup
        pendingExpirationLocalAlreadyCleared = localAlreadyCleared
        return
    }
    conversationExpirationRunning = true
    conversationExpiryPending = false
    pendingExpiredCleanup = null
    pendingExpirationLocalAlreadyCleared = false
    clearConversationExpiryTimer()
    const persistence = conversationPersistence
    const target = cleanup ?? {
        session: { ...conversationSession },
        videoId: draft.video?.videoId ?? null,
    }
    try {
        if (!localAlreadyCleared && persistence) {
            await conversationPersistenceWrite
            await persistence.clear()
        }
    } catch {
        failConversationPersistence()
        conversationExpirationRunning = false
        return
    }
    conversationSession = { ...target.session }
    conversationSessionInitialized = true
    applyMirroredConversationClear()
    conversationPersistenceReady.value = conversationSessionAuthorityReady
    formError.value = ''
    showConversationExpiredToast()
    conversationExpirationRunning = false

    void Promise.allSettled([
        clearAnalysisConversation(target.session),
        ...(target.videoId ? [browserAnalysisVideoTransport.cancel(target.videoId)] : []),
    ])
}

/** 用一个完整、已经校验的快照替换页面状态，不逐字段合并半份数据。 */
function applyConversationSnapshot(
    snapshot: AnalysisFormingConversationSnapshot,
    expiresAt: string,
    verified = true,
) {
    const transientTurnNotice = agentTurnLockNotice
    applyingPersistedConversation = true
    pendingNewConfirmationOnboarding = false
    completeAgentTyping()
    conversationTurnGeneration += 1
    conversationSession = { ...snapshot.session }
    conversationSessionInitialized = true
    conversationSessionAuthorityReady = verified
    draft.contentKind = snapshot.draft.contentKind
    draft.rawText = snapshot.draft.rawText
    draft.coverLocalId = snapshot.draft.coverLocalId ?? null
    draft.images = [...snapshot.draft.images]
    draft.video = snapshot.draft.video
    for (const fieldName of Object.keys(draft.fields) as TaskFieldName[]) {
        delete draft.fields[fieldName]
    }
    Object.assign(draft.fields, snapshot.draft.fields)
    conversationState.value = snapshot.conversationState
    draftPreview.value = snapshot.draftPreview
    draftPreparationId.value = snapshot.preparationId
    confirmationRevision.currentRevision = snapshot.confirmation.currentRevision
    confirmationRevision.confirmedRevision = snapshot.confirmation.confirmedRevision
    agentConfirmationVisible.value = snapshot.confirmation.visible
    // 旧版可能仅因缺素材隐藏了确认入口；恢复完整原文时提供可点击的复核入口。
    if (
        !snapshot.draftPreview &&
        snapshot.conversationState &&
        !snapshot.pendingTurn &&
        taskConfig.value &&
        !getDraftFieldIssue(draft, taskConfig.value)
    ) {
        confirmDraftRevision(confirmationRevision)
        agentConfirmationVisible.value = true
    }
    trackLocked.value = snapshot.trackLocked
    if (snapshot.conversationState?.rollingUsage) {
        startRollingUsageCooldown(snapshot.conversationState.rollingUsage)
    }
    agentComposerText.value = snapshot.pendingComposerText
    pendingConversationTurn.value = snapshot.pendingTurn
    analysisSubmission.invalidate()
    if (snapshot.preparationId) {
        analysisSubmission.acceptPreparation({
            preparationId: snapshot.preparationId,
        })
    }

    agentMessages.value = []
    appendRestoredMessage('agent', agentPresentationSelector.select('greeting'), 'greeting')
    const semanticHistory = snapshot.conversationState?.history ?? []
    for (const message of semanticHistory) {
        appendRestoredMessage(message.role === 'user' ? 'user' : 'agent', message.text)
    }
    const pendingAlreadyCommitted = Boolean(
        snapshot.pendingTurn &&
        semanticHistory.some(
            (message) => message.role === 'user' && message.id === snapshot.pendingTurn?.turnId,
        ),
    )
    if (snapshot.pendingTurn && !pendingAlreadyCommitted) {
        appendRestoredMessage('user', snapshot.pendingTurn.message)
    }
    if (snapshot.pendingTurn) {
        agentMessages.value.push({
            id: ++agentMessageId,
            role: 'agent',
            text: '...',
            typing: false,
            thinking: true,
        })
    }
    if (
        snapshot.confirmation.visible &&
        semanticHistory[semanticHistory.length - 1]?.role === 'user'
    ) {
        appendRestoredMessage('agent', agentPresentationSelector.select('draft_ready'))
    }
    if (transientTurnNotice) {
        appendRestoredMessage('agent', transientTurnNotice)
    }
    agentReplyPresentationGeneration += 1
    hasAgentReplyContext.value = agentMessages.value.some(
        (message) =>
            message.role === 'agent' &&
            !message.thinking &&
            message.kind !== 'greeting' &&
            message.kind !== 'technical_failure',
    )
    applyingPersistedConversation = false
    scheduleConversationExpiry(expiresAt)
}

/** 远端页面清空只重置当前镜像，不重复取消远端素材或再次广播。 */
function applyMirroredConversationClear() {
    applyingPersistedConversation = true
    resetDraft()
    draftPreview.value = null
    analysisSubmission.invalidate()
    resetAgentConversation()
    applyingPersistedConversation = false
}

function sameReferences(left: readonly string[], right: readonly string[]) {
    return (
        left.length === right.length && left.every((reference, index) => reference === right[index])
    )
}

/** 判断当前残留确认是否属于已经结束的任务，避免误删用户后来开始的新草稿。 */
function conversationMatchesTask(completedTask: AnalysisTask) {
    const preview = draftPreview.value
    return Boolean(
        preview &&
        preview.contentKind === completedTask.standardTask.contentKind &&
        preview.coverReference === completedTask.standardTask.coverReference &&
        preview.rawText === completedTask.standardTask.rawText &&
        sameReferences(preview.imageReferences, completedTask.standardTask.imageReferences),
    )
}

/** 新建分析前丢弃由已结束任务遗留的本地会话，不弹出普通草稿清空确认。 */
async function discardCompletedTaskConversation(completedTask: AnalysisTask) {
    if (operationsLocked.value) return false
    if (!hasTaskSessionContent.value || !conversationMatchesTask(completedTask)) return false
    const persistence = conversationPersistence
    if (persistence) {
        try {
            await conversationPersistenceWrite
            await persistence.clear()
        } catch {
            failConversationPersistence()
            return false
        }
    }
    applyMirroredConversationClear()
    formError.value = ''
    return true
}

async function resolveConversationAuthority(snapshot: AnalysisFormingConversationSnapshot) {
    const control = await getAnalysisConversationControl()
    const decision = reconcileConversationAuthority(snapshot.session, control)
    const snapshotWithBudget =
        control && snapshot.conversationState
            ? {
                  ...snapshot,
                  conversationState: {
                      ...snapshot.conversationState,
                      tokenBudget: control.tokenBudget ?? snapshot.conversationState.tokenBudget,
                      rollingUsage: control.rollingUsage,
                  },
              }
            : snapshot
    return decision.kind === 'adopt_generation'
        ? {
              decision,
              snapshot: {
                  ...snapshotWithBudget,
                  session: {
                      ...snapshotWithBudget.session,
                      generation: decision.generation,
                  },
              },
          }
        : { decision, snapshot: snapshotWithBudget }
}

/** 清除已失效的本地会话；调用方决定是否展示真实跨页面接管提示。 */
async function clearInvalidConversation(persistence: AnalysisConversationPersistence) {
    try {
        await persistence.clear()
    } catch {
        failConversationPersistence()
        return false
    }
    applyMirroredConversationClear()
    formError.value = ''
    conversationPersistenceReady.value = conversationSessionAuthorityReady
    return true
}

/** 只有活动会话被其他页面接管时才展示跨页面提示。 */
async function applySupersededConversation(persistence: AnalysisConversationPersistence) {
    if (!(await clearInvalidConversation(persistence))) return
    const message = t('workspace.agentChat.conversationSuperseded')
    await appendTypedAgentMessage(message)
}

/** 已提交、已结束或已清理的旧会话在登录恢复时静默丢弃。 */
async function discardEndedConversation(persistence: AnalysisConversationPersistence) {
    await clearInvalidConversation(persistence)
}

/** 本地快照已用于展示；权威校验只控制能否操作和后续状态收敛。 */
async function restoreVerifiedConversation(
    persistence: AnalysisConversationPersistence,
    snapshot: AnalysisFormingConversationSnapshot,
    expiresAt: string,
) {
    try {
        const resolved = await resolveConversationAuthority(snapshot)
        if (persistence !== conversationPersistence) return
        if (resolved.decision.kind === 'ended') {
            await discardEndedConversation(persistence)
            return
        }
        if (resolved.decision.kind === 'superseded') {
            await applySupersededConversation(persistence)
            return
        }
        const reconciledSnapshot = await reconcileRestoredVideo(resolved.snapshot)
        if (persistence !== conversationPersistence) return
        if (
            resolved.decision.kind === 'adopt_generation' ||
            reconciledSnapshot !== resolved.snapshot
        ) {
            await persistence.save(reconciledSnapshot)
        }
        if (persistence !== conversationPersistence) return
        formError.value = ''
        conversationInitializationFailed.value = false
        applyConversationSnapshot(reconciledSnapshot, expiresAt)
        conversationPersistenceReady.value = true
        await recoverPendingConversationTurn(persistence)
    } catch (error) {
        if (persistence !== conversationPersistence) return
        if (error instanceof AnalysisConversationPersistenceError) {
            failConversationPersistence(true, error)
        } else {
            // Keep encrypted IndexedDB state untouched and retry authority reconciliation after one second.
            conversationPersistenceReady.value = false
            conversationInitializationFailed.value = true
            formError.value = localConversationVisible.value
                ? ''
                : t('workspace.agentChat.coordinationUnavailable')
            const retryGeneration = conversationRecoveryGeneration
            await waitForConversationRecoveryPoll()
            if (
                retryGeneration === conversationRecoveryGeneration &&
                persistence === conversationPersistence
            ) {
                await restoreVerifiedConversation(persistence, snapshot, expiresAt)
            }
        }
    }
}

/** Loading 退出前，用服务端权威状态收敛本地恢复的视频。 */
async function reconcileRestoredVideo(
    snapshot: AnalysisFormingConversationSnapshot,
): Promise<AnalysisFormingConversationSnapshot> {
    const video = snapshot.draft.video
    if (!video?.videoId) return snapshot
    const reconciledVideo = await reconcileRestoredDraftVideo(video, browserAnalysisVideoTransport)
    if (reconciledVideo === video) return snapshot
    return {
        ...snapshot,
        draft: {
            ...snapshot.draft,
            video: reconciledVideo,
        },
    }
}

/** Reconcile the already-open page after a lightweight SSE invalidation or failed takeover turn. */
async function reconcileOpenConversationAuthority() {
    const persistence = conversationPersistence
    if (!persistence || !props.ownerUserId) return
    // 初次本地展示已有独立恢复流程；SSE 不得把待校验快照当成新会话接管。
    if (localConversationVisible.value && !conversationSessionAuthorityReady) return
    if (!conversationSessionAuthorityReady) {
        void preflightFreshConversationAuthority(persistence)
        return
    }
    if (
        previewing.value ||
        conversationAuthorityPending.value ||
        submitting.value ||
        authorityReconciliationActive
    ) {
        authorityReconciliationPending = true
        return
    }
    if (!hasTaskSessionContent.value) {
        conversationPersistenceReady.value = true
        return
    }

    authorityReconciliationActive = true
    authorityReconciliationPending = false
    try {
        await conversationPersistenceWrite
        const resolved = await resolveConversationAuthority(currentConversationSnapshot())
        if (resolved.decision.kind === 'ended') {
            await discardEndedConversation(persistence)
            return
        }
        if (resolved.decision.kind === 'superseded') {
            await applySupersededConversation(persistence)
            return
        }
        if (resolved.decision.kind === 'adopt_generation') {
            conversationSession = { ...resolved.snapshot.session }
            await persistence.save(resolved.snapshot)
        }
        conversationPersistenceReady.value = true
    } catch (error) {
        if (error instanceof AnalysisConversationPersistenceError) {
            failConversationPersistence(true, error)
        } else {
            conversationPersistenceReady.value = false
            formError.value = t('workspace.agentChat.coordinationUnavailable')
        }
    } finally {
        authorityReconciliationActive = false
        if (authorityReconciliationPending) {
            authorityReconciliationPending = false
            void reconcileOpenConversationAuthority()
        }
    }
}

function handleMirroredConversation(result: AnalysisConversationRestoreResult) {
    if (result.status === 'unavailable') {
        failConversationPersistence(false)
        return
    }
    if (result.status === 'restored') {
        stopConversationRecovery()
        applyConversationSnapshot(result.snapshot, result.expiresAt)
        formError.value = ''
        conversationInitializationFailed.value = false
        conversationPersistenceReady.value = true
        if (result.snapshot.pendingTurn && conversationPersistence) {
            void recoverPendingConversationTurn(conversationPersistence)
        }
        return
    }
    if (result.status === 'expired') {
        void expireCurrentConversation(result.cleanup, true)
        return
    }
    applyMirroredConversationClear()
    if (result.status === 'reset_corrupt') {
        formError.value = t('workspace.agentChat.localConversationReset')
    }
}

/** 为当前账号打开加密 IndexedDB 会话，并订阅同浏览器页面变化。 */
async function initializeConversationPersistence(userId: string | null) {
    stopConversationRecovery()
    const generation = ++conversationPersistenceGeneration
    if (conversationPersistenceOwner !== userId) {
        if (conversationPersistenceOwner !== null) {
            applyMirroredConversationClear()
        }
        conversationPersistenceOwner = userId
    }
    conversationPersistence?.close()
    conversationPersistence = null
    conversationPersistenceWrite = Promise.resolve()
    conversationPersistenceRetryPending = false
    conversationPersistenceReady.value = false
    conversationPersistenceHealthy.value = true
    localConversationVisible.value = false
    conversationInitializationFailed.value = false
    conversationAuthorityPending.value = false
    conversationSessionAuthorityReady = false
    if (!userId) {
        conversationPersistenceReady.value = true
        return
    }
    const manager = userStorage.files.value
    if (!manager) {
        conversationPersistenceReady.value = true
        failConversationPersistence()
        return
    }
    try {
        const persistence = await createBrowserAnalysisConversationPersistence({
            userId,
            manager,
        })
        const restored = await persistence.restore()
        if (generation !== conversationPersistenceGeneration) {
            persistence.close()
            return
        }
        conversationPersistence = persistence
        conversationSession = {
            ...conversationSession,
            browserInstanceId: persistence.browserInstanceId,
        }
        if (restored.status === 'restored') {
            // 先恢复同账号本地快照供查看；权威校验完成前统一禁止变更。
            applyConversationSnapshot(restored.snapshot, restored.expiresAt, false)
            localConversationVisible.value = true
            await restoreVerifiedConversation(persistence, restored.snapshot, restored.expiresAt)
        } else if (restored.status === 'expired') {
            await expireCurrentConversation(restored.cleanup, true)
        } else if (restored.status === 'reset_corrupt') {
            applyMirroredConversationClear()
            formError.value = t('workspace.agentChat.localConversationReset')
            await preflightFreshConversationAuthority(persistence)
        } else if (restored.status === 'unavailable') {
            failConversationPersistence()
            conversationPersistenceReady.value = true
        } else {
            conversationSessionAuthorityReady = false
            await preflightFreshConversationAuthority(persistence)
        }
        if (conversationPersistenceHealthy.value && !conversationPersistenceReady.value) {
            await preflightFreshConversationAuthority(persistence)
        }
        persistence.subscribe(handleMirroredConversation)
    } catch {
        if (generation !== conversationPersistenceGeneration) return
        conversationPersistenceReady.value = true
        failConversationPersistence()
    }
}

watch(
    () => props.ownerUserId,
    (userId) => void initializeConversationPersistence(userId),
    { immediate: true },
)

watch(conversationPersistenceReady, (ready) => {
    if (!ready || !conversationPersistenceRetryPending || !conversationPersistence) {
        return
    }
    conversationPersistenceRetryPending = false
    if (
        draftPreview.value ||
        (conversationState.value && isDraftRevisionConfirmed(confirmationRevision))
    ) {
        void confirmCurrentDraft().then(async (confirmed) => {
            if (!confirmed || !pendingNewConfirmationOnboarding) return
            await reportCurrentTaskConfirmation('new')
            pendingNewConfirmationOnboarding = false
        })
        return
    }
    void persistCurrentConversation()
})

watch(
    [previewing, conversationAuthorityPending, submitting, checkingStorage],
    ([isPreviewing, isAuthorityPending, isSubmitting, isCheckingStorage]) => {
        if (
            !conversationExpiryPending ||
            isPreviewing ||
            isAuthorityPending ||
            isSubmitting ||
            isCheckingStorage
        ) {
            return
        }
        const cleanup = pendingExpiredCleanup
        const localAlreadyCleared = pendingExpirationLocalAlreadyCleared
        void expireCurrentConversation(cleanup, localAlreadyCleared)
    },
)

watch(
    () => workspaceEvents.conversationRevision,
    () => void reconcileOpenConversationAuthority(),
)

/** 等待一小段时间以逐步显示 Agent 文本。 */
function waitForAgentTyping(delayMs: number) {
    return new Promise<void>((resolve) => window.setTimeout(resolve, delayMs))
}

/** 判断用户是否要求减少非必要动态效果。 */
function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

type AnalysisOnboardingEventOrigin = 'new' | 'restored'

/** 在稳定回复区域与自由输入挂载后报告一条真实回复。 */
async function establishAgentReplyPresentation(
    replyId: string,
    origin: AnalysisOnboardingEventOrigin,
): Promise<void> {
    const generation = ++agentReplyPresentationGeneration
    hasAgentReplyContext.value = true
    await nextTick()
    if (generation !== agentReplyPresentationGeneration) return
    onboardingEventReporter.reportAgentReply({
        replyId,
        origin,
        targetsReady: isOnboardingChapterTargetAvailable(document, 'agent_reply'),
    })
}

/** 确认事实已落盘且卡片挂载后才报告当前 revision。 */
async function reportCurrentTaskConfirmation(origin: AnalysisOnboardingEventOrigin): Promise<void> {
    const confirmedRevision = confirmationRevision.confirmedRevision
    if (confirmedRevision === null || !agentConfirmationCurrent.value || !draftPreview.value) {
        return
    }
    const confirmationId = `${draftPreparationId.value ?? conversationSession.sessionId}:${confirmedRevision}`
    await nextTick()
    if (
        confirmationRevision.confirmedRevision !== confirmedRevision ||
        !agentConfirmationCurrent.value ||
        !draftPreview.value
    ) {
        return
    }
    onboardingEventReporter.reportTaskConfirmation({
        confirmationId,
        origin,
        targetsReady: isOnboardingChapterTargetAvailable(document, 'task_confirmation'),
    })
}

/** 以有最长耗时上限的打字效果追加一条 Agent 消息。 */
async function appendTypedAgentMessage(text: string, kind?: AgentChatMessage['kind']) {
    completeAgentTyping()
    const characters = Array.from(text)
    const message = reactive<AgentChatMessage>({
        id: ++agentMessageId,
        role: 'agent',
        text: '',
        typing: true,
        kind,
    })
    agentMessages.value.push(message)
    const generation = typingGeneration
    activeTypingMessage = { message, fullText: text }
    agentTyping.value = true

    if (prefersReducedMotion()) {
        message.text = text
    } else {
        const maximumTicks = Math.max(
            1,
            Math.floor(
                analysisUiConstraints.agentTypingMaximumDurationMs /
                    analysisUiConstraints.agentTypingIntervalMs,
            ),
        )
        const charactersPerTick = Math.max(1, Math.ceil(characters.length / maximumTicks))
        for (let index = 0; index < characters.length; index += charactersPerTick) {
            if (generation !== typingGeneration) {
                return
            }
            message.text = characters.slice(0, index + charactersPerTick).join('')
            await waitForAgentTyping(analysisUiConstraints.agentTypingIntervalMs)
        }
    }

    if (generation === typingGeneration) {
        message.text = text
        message.typing = false
        agentTyping.value = false
        activeTypingMessage = null
    }
}

/** 用户继续操作时立即补全当前展示动画，不阻塞下一次真实请求。 */
function completeAgentTyping() {
    typingGeneration += 1
    if (activeTypingMessage) {
        activeTypingMessage.message.text = activeTypingMessage.fullText
        activeTypingMessage.message.typing = false
        activeTypingMessage = null
    }
    agentTyping.value = false
}

/** 为一个新任务清空伪对话并生成新的本地问候。 */
function resetAgentConversation(nextGeneration?: number) {
    stopConversationRecovery()
    completeAgentTyping()
    conversationTurnGeneration += 1
    agentMessages.value = []
    agentComposerText.value = ''
    agentTyping.value = false
    agentReplyPresentationGeneration += 1
    hasAgentReplyContext.value = false
    pendingNewConfirmationOnboarding = false
    agentConfirmationVisible.value = false
    conversationState.value = null
    pendingConversationTurn.value = null
    clearConversationExpiryTimer()
    const previousSession = conversationSession
    conversationSession = {
        sessionId: crypto.randomUUID(),
        generation:
            nextGeneration ??
            (conversationSessionInitialized
                ? previousSession.generation + 1
                : previousSession.generation),
        browserInstanceId: previousSession.browserInstanceId,
    }
    conversationSessionInitialized = true
    conversationSessionAuthorityReady = nextGeneration !== undefined
    if (
        nextGeneration === undefined &&
        conversationPersistence &&
        conversationPersistenceOwner === props.ownerUserId
    ) {
        void preflightFreshConversationAuthority(conversationPersistence)
    }
    void appendTypedAgentMessage(agentPresentationSelector.select('greeting'), 'greeting')
}

resetAgentConversation()
onBeforeUnmount(() => {
    draftImageUpload.dispose()
    if (mediaSubmitToastTimer !== null) clearTimeout(mediaSubmitToastTimer)
    stopConversationRecovery()
    conversationTurnGeneration += 1
    conversationPersistenceGeneration += 1
    conversationPersistence?.close()
    conversationPersistence = null
    completeAgentTyping()
    clearDraftCooldownTimer()
    if (conversationExpiredToastTimer !== null) {
        window.clearTimeout(conversationExpiredToastTimer)
    }
    clearConversationExpiryTimer()
})

/** 把未知异常转换为用户可读错误 */
function formatError(error: unknown) {
    return getApiRequestErrorMessage(error, t('workspace.genericError'))
}

/** 停止本地倒计时；服务端仍是发送窗口的唯一权威来源。 */
function clearDraftCooldownTimer() {
    if (draftCooldownTimer !== null) {
        window.clearInterval(draftCooldownTimer)
        draftCooldownTimer = null
    }
}

type DraftCooldown = NonNullable<ReturnType<typeof resolveDraftSendCooldown>>

/** 显示服务端权威倒计时，并只在边界到达前禁用 Agent 发送。 */
function applyDraftCooldown(cooldown: DraftCooldown) {
    clearDraftCooldownTimer()
    const updateCountdown = () => {
        draftCooldownRemainingSeconds.value = Math.max(
            0,
            Math.ceil((cooldown.retryAtMs - Date.now()) / TIME_MS.SECOND),
        )
        if (draftCooldownRemainingSeconds.value === 0) {
            clearDraftCooldownTimer()
            formError.value = ''
            return
        }
        if (cooldown.reason === 'rolling_agent_usage') {
            const duration = formatAgentCooldownDuration(
                draftCooldownRemainingSeconds.value,
                locale.value === 'en-US' ? 'en-US' : 'zh-CN',
            )
            formError.value =
                runtime.analysisText('usageLimited', {
                    duration,
                    canUpgrade: cooldown.canUpgrade,
                }) || t('workspace.agentChat.rollingRateLimited', { duration })
        } else {
            formError.value = t('workspace.agentChat.draftRateLimited', {
                minutes: Math.ceil(
                    (draftCooldownRemainingSeconds.value * TIME_MS.SECOND) / TIME_MS.MINUTE,
                ),
            })
        }
    }

    updateCountdown()
    draftCooldownTimer = window.setInterval(updateCountdown, TIME_MS.SECOND)
}

/** 将服务端 429 边界应用到页面。 */
function startDraftCooldown(error: unknown) {
    const cooldown = resolveDraftSendCooldown(error)
    if (!cooldown) return false
    applyDraftCooldown(cooldown)
    return true
}

/** 当前成功回合已经跨过滚动上限时，无需等待下一次失败请求即可进入同一倒计时。 */
function startRollingUsageCooldown(rollingUsage: AnalysisRollingUsage) {
    if (!rollingUsage.exhausted || !rollingUsage.retryAt || rollingUsage.retryAfterSeconds <= 0) {
        return
    }
    const retryAtMs = Date.now() + rollingUsage.retryAfterSeconds * TIME_MS.SECOND
    applyDraftCooldown({
        reason: 'rolling_agent_usage',
        retryAt: rollingUsage.retryAt,
        retryAtMs,
        remainingSeconds: rollingUsage.retryAfterSeconds,
        waitMinutes: Math.ceil((rollingUsage.retryAfterSeconds * TIME_MS.SECOND) / TIME_MS.MINUTE),
        canUpgrade: rollingUsage.canUpgrade,
    })
}

/** 使旧准备凭据和确认状态失效，但保留仍用于展示的 Agent 推断字段。 */
function invalidatePreparation() {
    invalidateDraftRevision(confirmationRevision)
    agentConfirmationVisible.value = false
    draftPreparationId.value = null
    analysisSubmission.invalidate()
}

/** 清除已失效的草稿预览和准备状态。 */
function invalidatePreview() {
    invalidatePreparation()
    draftPreview.value = null
}

/** 原文完整即可展示确认；素材是否齐全在点击开始分析时单独校验。 */
async function confirmCurrentDraft(): Promise<boolean> {
    if (
        (!draftPreview.value &&
            (!conversationState.value || !isDraftRevisionConfirmed(confirmationRevision))) ||
        !taskConfig.value ||
        getDraftFieldIssue(draft, taskConfig.value)
    ) {
        return false
    }
    confirmDraftRevision(confirmationRevision)
    const saved = await persistCurrentConversation({ confirmationVisible: true })
    if (
        saved &&
        conversationPersistenceHealthy.value &&
        isDraftRevisionConfirmed(confirmationRevision)
    ) {
        agentConfirmationVisible.value = true
        return true
    }
    return false
}

/** 素材变化不丢弃已经形成的字段，但旧准备凭据与确认版本立即失效。 */
function invalidateForMediaChange() {
    const textWasConfirmed = isDraftRevisionConfirmed(confirmationRevision)
    invalidateDraftRevision(confirmationRevision)
    // 素材变动保留已核对原文的展示资格，实际提交仍重新检查素材及准备凭据。
    if (textWasConfirmed) confirmDraftRevision(confirmationRevision)
    agentConfirmationVisible.value = false
    analysisSubmission.invalidate({ preservePreparation: true })
}

function restoreConfirmationAfterMediaChange(): boolean {
    if (
        draftPreview.value ||
        (conversationState.value && isDraftRevisionConfirmed(confirmationRevision))
    ) {
        void confirmCurrentDraft()
        return true
    }
    return false
}

/** 解析指定字段当前生效的值和来源 */
function resolvedField(fieldName: TaskFieldName) {
    return resolveDraftFieldForDisplay(draft, fieldName, draftPreview.value)
}

/** 读取字段用于条件显示的最终值 */
function effectiveFieldValue(fieldName: TaskFieldName) {
    const resolvedValue = resolvedField(fieldName)?.value
    if (resolvedValue !== undefined && resolvedValue !== null) {
        return resolvedValue
    }
    return taskConfig.value?.fields.find((field) => field.name === fieldName)?.defaultValue
}

/** 更新单个草稿字段，使旧准备凭据失效并保留其他 Agent 推断字段。 */
function updateDraftField(fieldName: TaskFieldName, value: TaskFieldValue | undefined) {
    if (operationsLocked.value) return
    if (value === undefined) {
        delete draft.fields[fieldName]
    } else {
        draft.fields[fieldName] = value
    }
    invalidatePreparation()
    void persistCurrentConversation()
}

/** 更新草稿图片并使旧预览失效 */
const draftImageUpload = createDraftImageUpload(
    {
        read: () => draft.images,
        update: updateDraftImages,
        rateLimited: clearDraftMediaAfterUploadLimit,
    },
    browserAnalysisMediaTransport,
)

function updateDraftImages(images: SharedTaskImage[]) {
    const previousIdentity = draft.images
        .map(
            (image) =>
                `${image.localId}:${image.assetId}:${image.contentHash}:${image.status}:${image.errorCode}`,
        )
        .join('|')
    const nextIdentity = images
        .map(
            (image) =>
                `${image.localId}:${image.assetId}:${image.contentHash}:${image.status}:${image.errorCode}`,
        )
        .join('|')
    draft.images = [...images]
    if (!images.some((image) => image.localId === draft.coverLocalId)) {
        draft.coverLocalId = images[0]?.localId ?? null
    }
    formError.value = ''
    if (previousIdentity !== nextIdentity) invalidateForMediaChange()
    if (!restoreConfirmationAfterMediaChange()) void persistCurrentConversation()
}

/** 指定封面只更新标记，保持图文素材原有顺序和上传身份。 */
function updateDraftCover(localId: string) {
    if (operationsLocked.value) return
    if (submitting.value || previewing.value || checkingStorage.value) return
    if (!draft.images.some((image) => image.localId === localId)) return
    if (draft.coverLocalId === localId) return
    draft.coverLocalId = localId
    invalidateForMediaChange()
    if (!restoreConfirmationAfterMediaChange()) void persistCurrentConversation()
}

/** 聊天前切换保留素材；聊天后必须确认清空当前任务。 */
async function updateContentKind(contentKind: AnalysisContentKind) {
    if (operationsLocked.value || draft.contentKind === contentKind) return
    if (contentKind === 'video' && videoUnavailableMessage.value) {
        formError.value = videoUnavailableMessage.value
        return
    }
    if (trackLocked.value) {
        requestClearConversation(contentKind)
        return
    }
    setDraftContentKind(draft, contentKind)
    formError.value = ''
    invalidatePreview()
    await persistCurrentConversation()
}

/** 清空代表开始新任务；有内容时必须先经过定制确认弹窗。 */
function requestClearConversation(contentKind: AnalysisContentKind | null = null) {
    if (operationsLocked.value) return
    if (!hasTaskSessionContent.value) {
        void startNewTask(contentKind)
        return
    }
    pendingNewTaskContentKind.value = contentKind
    clearConversationConfirmationOpen.value = true
}

function cancelClearConversation() {
    clearConversationConfirmationOpen.value = false
    pendingNewTaskContentKind.value = null
}

async function confirmClearConversation() {
    const contentKind = pendingNewTaskContentKind.value
    cancelClearConversation()
    await startNewTask(contentKind)
}

/** 放弃当前本地任务内容，并保留账号已经选择的赛道作为下一任务默认值。 */
async function startNewTask(contentKind: AnalysisContentKind | null) {
    completeAgentTyping()
    const videoId = draft.video?.videoId ?? null
    let nextGeneration: number | undefined
    try {
        if (conversationPersistence) {
            const persistence = conversationPersistence
            const mutation = await persistence.runResultMutation(async () => {
                const cleared = await clearAnalysisConversation(conversationSession)
                await persistence.clear()
                return cleared
            })
            if (mutation.status !== 'acquired') {
                formError.value = t('workspace.agentChat.coordinationUnavailable')
                return
            }
            nextGeneration = mutation.value.generation
        } else {
            const cleared = await clearAnalysisConversation(conversationSession)
            nextGeneration = cleared.generation
        }
    } catch (error) {
        const message = formatError(error)
        if (message === t('workspace.agentChat.conversationSuperseded')) {
            if (conversationPersistence) {
                try {
                    await conversationPersistence.clear()
                } catch {
                    failConversationPersistence()
                    return
                }
            }
            applyMirroredConversationClear()
            formError.value = message
            return
        }
        formError.value = message
        return
    }
    resetDraft()
    draftAnalyticsRecorded.value = false
    if (contentKind) draft.contentKind = contentKind
    draftPreview.value = null
    confirmationRevision.currentRevision = 0
    confirmationRevision.confirmedRevision = null
    draftPreparationId.value = null
    analysisSubmission.invalidate()
    formError.value = ''
    resetAgentConversation(nextGeneration)
    if (videoId) {
        void browserAnalysisVideoTransport.cancel(videoId).catch(() => undefined)
    }
}

/** 更新唯一视频草稿；视频预处理状态仍以认证后端为准。 */
function updateDraftVideo(video: SharedTaskVideo | null) {
    const previousIdentity = draft.video
        ? `${draft.video.localId}:${draft.video.videoId}:${draft.video.evidenceId}:${draft.video.status}:${draft.video.errorCode}`
        : ''
    const nextIdentity = video
        ? `${video.localId}:${video.videoId}:${video.evidenceId}:${video.status}:${video.errorCode}`
        : ''
    draft.video = video
    formError.value = ''
    if (previousIdentity !== nextIdentity) invalidateForMediaChange()
    if (!restoreConfirmationAfterMediaChange()) void persistCurrentConversation()
}

/** 服务端已作废共享草稿素材时同步清空本地附件，保留聊天和文字字段。 */
function clearDraftMediaAfterUploadLimit() {
    draft.images = []
    draft.coverLocalId = null
    draft.video = null
    formError.value = t('workspace.upload.rateLimited')
    invalidateForMediaChange()
    void persistCurrentConversation()
}

/** 同步 Agent 输入框；已有确认只在用户真正发送下一轮时失效。 */
function updateAgentComposerText(value: string) {
    if (operationsLocked.value) return
    agentComposerText.value = value
    const hasPreviousUserMessage = agentMessages.value.some((message) => message.role === 'user')
    if (!hasPreviousUserMessage) {
        draft.rawText = value
        invalidatePreview()
    }
}

/** 同浏览器页面竞争或协调能力缺失时使用固定前端文案，不调用 Provider。 */
async function reportAgentTurnLock(status: 'busy' | 'unavailable') {
    const message =
        status === 'busy'
            ? t('workspace.agentChat.turnBusy')
            : t('workspace.agentChat.coordinationUnavailable')
    formError.value = ''
    agentTurnLockNotice = message
    await appendTypedAgentMessage(message)
}

/** 本地没有可恢复会话时，在首次真实发送前读取账号权威代数。 */
async function initializeFreshConversationAuthority(
    persistence: AnalysisConversationPersistence,
    timeoutMs?: number,
) {
    if (conversationSessionAuthorityReady) return true
    const persistenceGeneration = conversationPersistenceGeneration
    conversationAuthorityPending.value = true
    formError.value = ''
    try {
        const control = await getAnalysisConversationControl(timeoutMs)
        if (
            persistenceGeneration !== conversationPersistenceGeneration ||
            persistence !== conversationPersistence
        ) {
            return false
        }
        if (conversationSessionAuthorityReady) return true
        conversationSession = createFreshConversationSession(
            persistence.browserInstanceId,
            crypto.randomUUID(),
            control,
        )
        conversationSessionInitialized = true
        conversationSessionAuthorityReady = true
        conversationInitializationFailed.value = false
        return true
    } catch {
        if (
            persistenceGeneration === conversationPersistenceGeneration &&
            persistence === conversationPersistence
        ) {
            conversationInitializationFailed.value = true
            formError.value = t('workspace.agentChat.coordinationUnavailable')
        }
        return false
    } finally {
        if (
            persistenceGeneration === conversationPersistenceGeneration &&
            persistence === conversationPersistence
        ) {
            conversationAuthorityPending.value = false
        }
    }
}

/** POST 前先保存权威 session 和待确认输入，刷新不得退回旧 session。 */
async function persistPendingConversationTurn(
    persistence: AnalysisConversationPersistence,
    message: string,
) {
    try {
        const saved = await persistence.save(currentConversationSnapshot(message))
        scheduleConversationExpiry(saved.expiresAt)
        return true
    } catch (error) {
        failConversationPersistence(true, error)
        return false
    }
}

/** 首次会话先取得只读权威代数；成功前发送按钮保持不可用，短暂失败每秒重试。 */
function preflightFreshConversationAuthority(persistence: AnalysisConversationPersistence) {
    if (activeFreshAuthorityPreflight?.persistence === persistence) {
        return activeFreshAuthorityPreflight.promise
    }
    const promise = runFreshConversationAuthorityPreflight(persistence)
    const active = { persistence, promise }
    activeFreshAuthorityPreflight = active
    void promise.finally(() => {
        if (activeFreshAuthorityPreflight === active) activeFreshAuthorityPreflight = null
    })
    return promise
}

async function runFreshConversationAuthorityPreflight(
    persistence: AnalysisConversationPersistence,
) {
    conversationPersistenceReady.value = false
    while (persistence === conversationPersistence && !conversationSessionAuthorityReady) {
        const initialized = await initializeFreshConversationAuthority(persistence)
        if (initialized) {
            formError.value = ''
            conversationPersistenceReady.value = true
            return
        }
        await waitForConversationRecoveryPoll()
    }
}

/** 整包结果只通过这一处提交到页面与 IndexedDB。 */
async function applyCompletedConversationTurn(
    currentState: AnalysisConversationState,
    turnId: string,
    message: string,
    result: AnalysisConversationTurnResult,
) {
    const presentation = presentAgentConversationTurn(result, agentPresentationSelector)
    conversationSession = { ...result.session }
    conversationSessionAuthorityReady = true
    const alreadyCommitted = currentState.history.some(
        (historyMessage) => historyMessage.role === 'user' && historyMessage.id === turnId,
    )
    const nextState = alreadyCommitted
        ? currentState
        : commitConversationTurn(currentState, {
              messageId: turnId,
              message,
              result,
              questionId: () => crypto.randomUUID(),
          })
    invalidateDraftRevision(confirmationRevision)
    if (presentation.showConfirmation) confirmDraftRevision(confirmationRevision)
    agentConfirmationVisible.value = false
    conversationState.value = nextState
    startRollingUsageCooldown(result.rollingUsage)
    draft.rawText = result.effectiveDraft.rawText
    for (const fieldName of Object.keys(draft.fields) as TaskFieldName[]) {
        delete draft.fields[fieldName]
    }
    Object.assign(draft.fields, result.effectiveDraft.fields)
    draftPreview.value = result.standardTask
    draftPreparationId.value = result.preparationId
    if (result.preparationId) {
        analysisSubmission.acceptPreparation({ preparationId: result.preparationId })
    } else {
        analysisSubmission.invalidate()
    }
    trackLocked.value = true
    agentComposerText.value = ''
    const saved = await persistCurrentConversation({
        confirmationVisible: presentation.showConfirmation,
    })
    if (!saved) {
        throw new AnalysisConversationPersistenceError('storage_unavailable')
    }
    return presentation
}

/** 服务端确认领取后，再把本地 pending 墓碑原子收口为可展示结果。 */
async function finalizeAcknowledgedConversationTurn(
    pending: AnalysisConversationPendingTurn,
    confirmationVisible: boolean,
) {
    if (pendingConversationTurn.value?.turnId !== pending.turnId) return false
    pendingConversationTurn.value = null
    const saved = await persistCurrentConversation({ confirmationVisible })
    if (!saved) {
        pendingConversationTurn.value = pending
        throw new AnalysisConversationPersistenceError('storage_unavailable')
    }
    return true
}

/** ACK 与最终本地写入共享一把短锁，保证跨页 clear 或结果收口只有最后一次写生效。 */
async function acknowledgeAndFinalizeConversationTurn(
    persistence: AnalysisConversationPersistence,
    pending: AnalysisConversationPendingTurn,
    session: AnalysisFormingConversationSnapshot['session'],
    confirmationVisible: boolean,
) {
    const mutation = await persistence.runResultMutation(async () => {
        const acknowledged = await acknowledgeAnalysisConversationTurn(pending.turnId, session)
        if (!acknowledged) return false
        return finalizeAcknowledgedConversationTurn(pending, confirmationVisible)
    })
    if (mutation.status !== 'acquired') {
        throw new AnalysisConversationPersistenceError('storage_unavailable')
    }
    return mutation.value
}

function stopConversationRecovery() {
    conversationRecoveryGeneration += 1
    if (activeConversationRecoveryGeneration !== null) {
        activeConversationRecoveryGeneration = null
        previewing.value = false
    }
    for (const [timer, resolve] of conversationRecoveryWaiters) {
        window.clearTimeout(timer)
        resolve()
    }
    conversationRecoveryWaiters.clear()
}

function waitForConversationRecoveryPoll() {
    return new Promise<void>((resolve) => {
        const timer = window.setTimeout(() => {
            conversationRecoveryWaiters.delete(timer)
            resolve()
        }, TIME_MS.SECOND)
        conversationRecoveryWaiters.set(timer, resolve)
    })
}

function ensurePendingConversationMessages(pending: AnalysisConversationPendingTurn) {
    if (
        !agentMessages.value.some(
            (message) => message.role === 'user' && message.text === pending.message,
        )
    ) {
        appendRestoredMessage('user', pending.message)
    }
    if (!agentMessages.value.some((message) => message.thinking)) {
        agentMessages.value.push({
            id: ++agentMessageId,
            role: 'agent',
            text: '...',
            typing: false,
            thinking: true,
        })
    }
}

async function restorePendingConversationInput(pending: AnalysisConversationPendingTurn) {
    const pendingMessageId = [...agentMessages.value]
        .reverse()
        .find((message) => message.role === 'user' && message.text === pending.message)?.id
    if (pendingMessageId !== undefined) {
        agentMessages.value = agentMessages.value.filter(
            (message) => message.id !== pendingMessageId,
        )
    }
    pendingConversationTurn.value = null
    agentComposerText.value = pending.message
    await persistCurrentConversation()
}

/** ACK 已由另一页面完成时，以共享密文快照收敛，不再用旧页面状态覆盖。 */
async function restoreAcknowledgedConversationTurn(
    persistence: AnalysisConversationPersistence,
    pending: AnalysisConversationPendingTurn,
) {
    const restored = await persistence.restore()
    if (restored.status !== 'restored') return restored
    const committed = restored.snapshot.conversationState?.history.some(
        (message) => message.role === 'user' && message.id === pending.turnId,
    )
    if (!committed) return null
    if (restored.snapshot.pendingTurn?.turnId !== pending.turnId) return restored
    const snapshot: AnalysisFormingConversationSnapshot = {
        ...restored.snapshot,
        pendingTurn: null,
    }
    const saved = await persistence.save(snapshot)
    return {
        status: 'restored' as const,
        snapshot,
        expiresAt: saved.expiresAt,
    }
}

/** 同一浏览器仅由持有回合锁的页面领取临时结果。 */
async function recoverPendingConversationTurn(persistence: AnalysisConversationPersistence) {
    const pending = pendingConversationTurn.value
    if (!pending) return
    conversationRecoveryPending.value = true
    ensurePendingConversationMessages(pending)
    const generation = ++conversationRecoveryGeneration
    const recoverySession = { ...conversationSession }
    activeConversationRecoveryGeneration = generation
    previewing.value = true
    try {
        const locked = await persistence.runAgentTurn(async () => {
            while (generation === conversationRecoveryGeneration) {
                let recovered
                try {
                    recovered = await recoverAnalysisConversationTurn(
                        pending.turnId,
                        recoverySession,
                    )
                    if (
                        generation !== conversationRecoveryGeneration ||
                        persistence !== conversationPersistence
                    )
                        return null
                    conversationInitializationFailed.value = false
                } catch {
                    conversationInitializationFailed.value = true
                    await waitForConversationRecoveryPoll()
                    continue
                }
                if (recovered.status === 'completed') {
                    const currentState = conversationState.value
                    if (!currentState) {
                        await restorePendingConversationInput(pending)
                        return { kind: 'failed' as const }
                    }
                    let presentation
                    try {
                        presentation = await applyCompletedConversationTurn(
                            currentState,
                            pending.turnId,
                            pending.message,
                            recovered.result,
                        )
                    } catch {
                        return { kind: 'storage_failed' as const }
                    }
                    let acknowledged = false
                    try {
                        acknowledged = await acknowledgeAndFinalizeConversationTurn(
                            persistence,
                            pending,
                            recoverySession,
                            presentation.showConfirmation,
                        )
                    } catch {
                        await waitForConversationRecoveryPoll()
                        continue
                    }
                    if (!acknowledged) continue
                    return { kind: 'completed' as const, presentation }
                }
                if (recovered.status === 'acknowledged') {
                    let restored
                    try {
                        const mutation = await persistence.runResultMutation(() =>
                            restoreAcknowledgedConversationTurn(persistence, pending),
                        )
                        if (mutation.status !== 'acquired') {
                            return { kind: 'storage_failed' as const }
                        }
                        restored = mutation.value
                    } catch (error) {
                        failConversationPersistence(true, error)
                        return { kind: 'storage_failed' as const }
                    }
                    if (!restored) {
                        await waitForConversationRecoveryPoll()
                        continue
                    }
                    return { kind: 'restored' as const, restored }
                }
                if (recovered.status === 'cancelled') {
                    if (recovered.reason === 'logged_out') {
                        try {
                            const mutation = await persistence.runResultMutation(async () => {
                                const resultAlreadyPersisted =
                                    conversationState.value?.history.some(
                                        (message) =>
                                            message.role === 'user' &&
                                            message.id === pending.turnId,
                                    )
                                if (resultAlreadyPersisted) {
                                    await finalizeAcknowledgedConversationTurn(
                                        pending,
                                        Boolean(draftPreview.value),
                                    )
                                    return { kind: 'converged' as const }
                                }
                                await restorePendingConversationInput(pending)
                                return { kind: 'failed' as const }
                            })
                            return mutation.status === 'acquired'
                                ? mutation.value
                                : { kind: 'storage_failed' as const }
                        } catch {
                            return { kind: 'storage_failed' as const }
                        }
                    }
                    try {
                        await persistence.clear()
                    } catch (error) {
                        failConversationPersistence(true, error)
                        return { kind: 'storage_failed' as const }
                    }
                    return { kind: 'cleared' as const }
                }
                if (recovered.status !== 'processing') {
                    await restorePendingConversationInput(pending)
                    return { kind: 'failed' as const }
                }
                await waitForConversationRecoveryPoll()
            }
            return null
        })
        if (generation !== conversationRecoveryGeneration) return
        if (locked.status === 'busy') {
            await waitForConversationRecoveryPoll()
            if (generation === conversationRecoveryGeneration) {
                await recoverPendingConversationTurn(persistence)
            }
            return
        }
        if (locked.status !== 'acquired') {
            formError.value = t('workspace.agentChat.coordinationUnavailable')
            return
        }
        if (!locked.value) return
        agentMessages.value = agentMessages.value.filter((message) => !message.thinking)
        if (locked.value.kind === 'restored') {
            handleMirroredConversation(locked.value.restored)
            return
        }
        if (locked.value.kind === 'cleared') {
            applyMirroredConversationClear()
            return
        }
        if (locked.value.kind === 'converged') return
        if (locked.value.kind === 'completed') {
            await appendTypedAgentMessage(locked.value.presentation.text)
            let confirmationEstablished = false
            if (
                generation === conversationRecoveryGeneration &&
                locked.value.presentation.showConfirmation
            ) {
                confirmationEstablished = await confirmCurrentDraft()
            }
            await establishAgentReplyPresentation(`restored:${pending.turnId}`, 'restored')
            if (confirmationEstablished) {
                await reportCurrentTaskConfirmation('restored')
            }
            return
        }
        if (locked.value.kind === 'failed') {
            await appendTypedAgentMessage(
                agentPresentationSelector.select('technical_failure'),
                'technical_failure',
            )
        }
    } finally {
        if (activeConversationRecoveryGeneration === generation) {
            activeConversationRecoveryGeneration = null
            previewing.value = false
        }
        conversationRecoveryPending.value = false
    }
}

/** 把用户原文送入同一真实会话；正式体检仍需完整草稿确认。 */
async function sendAgentTurn() {
    agentTurnLockNotice = null
    if (agentTyping.value) completeAgentTyping()
    const config = taskConfig.value
    if (
        !config ||
        !canSubmit.value ||
        !agentSendAvailable.value ||
        accessBlockMessage.value ||
        previewing.value ||
        submitting.value
    )
        return
    pendingNewConfirmationOnboarding = false
    await sendRealConversationTurn(config)
}
/** 整包成功后才提交语义历史、草稿和确认凭据。 */
async function sendRealConversationTurn(config: AnalysisTaskConfig) {
    const turnGeneration = ++conversationTurnGeneration
    let requestFailed = false
    let turnRequestStarted = false
    let pendingUserMessageId: number | null = null
    const inputText = agentComposerText.value.trim()
    const hasPreviousUserMessage = Boolean(conversationState.value?.history.length)
    const message =
        inputText ||
        (!hasPreviousUserMessage ? draft.rawText.trim() : '') ||
        t('workspace.agentChat.imageOnlyMessage', { count: activeDraftImages(draft).length })
    const payload = createDraftPayload(draft, 'agent')
    const completeDraft = materializeConversationDraft(
        config,
        payload,
        conversationState.value?.completeDraft,
    )
    const currentState = conversationState.value
        ? { ...conversationState.value, completeDraft }
        : createConversationState(completeDraft)
    const messageId = crypto.randomUUID()
    const persistence = conversationPersistence
    if (!persistence) {
        await reportAgentTurnLock('unavailable')
        return
    }
    const previousConfirmationVisible = agentConfirmationVisible.value
    const pendingTurn = { turnId: messageId, message }
    pendingConversationTurn.value = pendingTurn
    try {
        const turn = await persistence.runAgentTurn(async () => {
            if (
                !(await initializeFreshConversationAuthority(
                    persistence,
                    config.runtime.preparationRequestTimeoutMs,
                ))
            ) {
                return null
            }
            conversationState.value = currentState
            if (!(await persistPendingConversationTurn(persistence, message))) {
                pendingConversationTurn.value = null
                agentConfirmationVisible.value = previousConfirmationVisible
                return null
            }
            const recoverySession = { ...conversationSession }
            const request = createConversationTurnRequest({
                session: {
                    ...recoverySession,
                    requestId: messageId,
                },
                state: currentState,
                message,
                draft: payload,
                contentKind: draft.contentKind,
                media: {
                    images: activeDraftImages(draft).map((image) => ({
                        reference: image.assetId!,
                        mediaType: image.file.type as 'image/jpeg' | 'image/png' | 'image/webp',
                        byteSize: image.file.size,
                    })),
                    video:
                        draft.contentKind === 'video' && draft.video?.videoId
                            ? {
                                  reference: draft.video.videoId,
                                  mediaType: draft.video.declaredMediaType,
                                  byteSize: draft.video.byteSize,
                              }
                            : null,
                },
            })
            formError.value = ''
            agentConfirmationVisible.value = false
            previewing.value = true
            agentMessages.value = agentMessages.value.filter(
                (messageItem) => messageItem.kind !== 'technical_failure',
            )
            pendingUserMessageId = ++agentMessageId
            agentMessages.value.push({
                id: pendingUserMessageId,
                role: 'user',
                text: message,
                typing: false,
            })
            if (inputText && agentComposerText.value.trim() === inputText) {
                agentComposerText.value = ''
            }
            const thinkingMessageId = ++agentMessageId
            agentMessages.value.push({
                id: thinkingMessageId,
                role: 'agent',
                text: '...',
                typing: false,
                thinking: true,
            })
            try {
                turnRequestStarted = true
                const response = await formAnalysisConversationTurn(
                    request,
                    config.runtime.preparationRequestTimeoutMs,
                )
                const result = response.data.data.result
                if (
                    turnGeneration !== conversationTurnGeneration ||
                    persistence !== conversationPersistence
                ) {
                    return null
                }
                const presentation = await applyCompletedConversationTurn(
                    currentState,
                    messageId,
                    message,
                    result,
                )
                const acknowledged = await acknowledgeAndFinalizeConversationTurn(
                    persistence,
                    pendingTurn,
                    recoverySession,
                    presentation.showConfirmation,
                )
                if (!acknowledged) throw new Error('Agent 回合领取状态已变化')
                return presentation
            } finally {
                agentMessages.value = agentMessages.value.filter(
                    (messageItem) => messageItem.id !== thinkingMessageId,
                )
                previewing.value = false
            }
        })
        if (turn.status !== 'acquired') {
            pendingConversationTurn.value = null
            agentConfirmationVisible.value = previousConfirmationVisible
            await reportAgentTurnLock(turn.status)
            return
        }
        if (turn.value === null) {
            pendingConversationTurn.value = null
            agentConfirmationVisible.value = previousConfirmationVisible
            return
        }

        // 锁只覆盖 Provider 与原子落盘；打字动画不会阻止任一页面继续下一轮。
        await appendTypedAgentMessage(turn.value.text)
        let confirmationEstablished = false
        if (turnGeneration === conversationTurnGeneration) {
            if (turn.value.showConfirmation) {
                pendingNewConfirmationOnboarding = true
                confirmationEstablished = await confirmCurrentDraft()
            } else agentConfirmationVisible.value = false
        }
        await establishAgentReplyPresentation(messageId, 'new')
        if (confirmationEstablished) {
            await reportCurrentTaskConfirmation('new')
            pendingNewConfirmationOnboarding = false
        }
    } catch (error) {
        if (
            turnGeneration !== conversationTurnGeneration ||
            persistence !== conversationPersistence
        ) {
            return
        }
        const message = formatError(error)
        const superseded = message === t('workspace.agentChat.conversationSuperseded')
        const busy = message === t('workspace.agentChat.turnBusy')
        const cooldownStarted = startDraftCooldown(error)
        if (error instanceof AnalysisConversationPersistenceError) {
            return
        }
        if (
            turnRequestStarted &&
            pendingConversationTurn.value?.turnId === messageId &&
            !superseded &&
            !busy &&
            !cooldownStarted
        ) {
            void recoverPendingConversationTurn(persistence)
            return
        }
        requestFailed = true
        pendingConversationTurn.value = null
        if (!superseded) agentConfirmationVisible.value = previousConfirmationVisible
        if (pendingUserMessageId !== null) {
            agentMessages.value = agentMessages.value.filter(
                (messageItem) => messageItem.id !== pendingUserMessageId,
            )
        }
        if (
            message !== t('workspace.agentChat.conversationSuperseded') &&
            inputText &&
            !agentComposerText.value.trim()
        ) {
            agentComposerText.value = inputText
        }
        if (superseded) {
            await applySupersededConversation(persistence)
        } else if (busy) {
            formError.value = ''
            await appendTypedAgentMessage(message)
        } else if (!cooldownStarted) {
            formError.value = ''
            await appendTypedAgentMessage(
                agentPresentationSelector.select('technical_failure'),
                'technical_failure',
            )
        }
        await persistCurrentConversation()
    } finally {
        if (requestFailed || authorityReconciliationPending) {
            await reconcileOpenConversationAuthority()
        }
    }
}

/** 隐藏确认卡，邀请用户继续补充或修正当前任务。 */
function adjustAgentDraft() {
    completeAgentTyping()
    agentConfirmationVisible.value = false
    agentComposerText.value = draft.rawText
    invalidatePreview()
    void persistCurrentConversation()
    void appendTypedAgentMessage(agentPresentationSelector.select('adjustment'))
}

/** 清空当前任务草稿 */
function resetDraft() {
    const trackId = selectedTrackId.value
    const customTrackName = selectedCustomTrackName.value
    draft.contentKind = 'image'
    draft.rawText = ''
    draft.images = []
    draft.coverLocalId = null
    draft.video = null
    for (const fieldName of Object.keys(draft.fields) as TaskFieldName[]) {
        delete draft.fields[fieldName]
    }
    if (trackId) draft.fields.track = trackId
    if (trackId === 'custom' && customTrackName) {
        draft.fields.customTrackName = customTrackName
    }
    trackLocked.value = false
    confirmationRevision.currentRevision = 0
    confirmationRevision.confirmedRevision = null
    agentConfirmationVisible.value = false
    draftPreparationId.value = null
}

/** 组装当前预览或提交所需的输入 */
function currentSubmissionInput(config: AnalysisTaskConfig): AnalysisSubmissionInput {
    return {
        draft,
        mode: mode.value,
        confirmationRevision:
            confirmationRevision.confirmedRevision ?? confirmationRevision.currentRevision,
        conversationSession: conversationState.value ? { ...conversationSession } : null,
        timeoutMs: config.runtime.preparationRequestTimeoutMs,
    }
}

/** 把任务字段值格式化为界面文本 */
function formatFieldValue(value: TaskFieldValue | undefined, field?: TaskFieldDefinition) {
    return formatTaskFieldValue(value, t, field)
}

type DraftPreviewOutcome =
    | { kind: 'blocked' }
    | { kind: 'completed' }
    | { kind: 'failed'; message: string; cooldown: boolean }

/** 请求预览当前草稿并返回本轮明确结果。 */
async function previewDraftOutcome(): Promise<DraftPreviewOutcome> {
    const config = taskConfig.value
    if (!canSubmit.value || previewing.value || !config || !validateRequiredDraftFields()) {
        return { kind: 'blocked' }
    }

    formError.value = ''
    previewing.value = true
    try {
        const { acceptance, standardTask, preparationId } = await analysisSubmission.preview(
            currentSubmissionInput(config),
        )
        draftPreview.value = standardTask
        draftPreparationId.value = preparationId
        if (standardTask) confirmDraftRevision(confirmationRevision)
        if (acceptance.status !== 'accepted') {
            formError.value = acceptance.message
        }
        trackLocked.value = true
        return { kind: 'completed' }
    } catch (error) {
        const cooldown = startDraftCooldown(error)
        return {
            kind: 'failed',
            message: cooldown ? formError.value : formatError(error),
            cooldown,
        }
    } finally {
        previewing.value = false
    }
}

/** 定制界面只关心预览是否完成，内部失败细节由表单状态承载。 */
async function previewDraft() {
    const outcome = await previewDraftOutcome()
    if (outcome.kind === 'failed' && !outcome.cooldown) {
        formError.value = outcome.message
    }
    return outcome.kind === 'completed'
}

/** 执行正式提交前的重复和容量检查 */
async function submitDraft() {
    completeAgentTyping()
    const config = taskConfig.value
    if (
        !canRequestAnalysis.value ||
        pendingConversationTurn.value !== null ||
        previewing.value ||
        submitting.value ||
        checkingStorage.value ||
        !config ||
        (mode.value === 'agent' && !isDraftRevisionConfirmed(confirmationRevision))
    ) {
        return
    }

    if (mediaRequirementMessage.value) {
        mediaSubmitToast.value = mediaRequirementMessage.value
        if (mediaSubmitToastTimer !== null) clearTimeout(mediaSubmitToastTimer)
        mediaSubmitToastTimer = setTimeout(() => {
            mediaSubmitToast.value = ''
            mediaSubmitToastTimer = null
        }, analysisUiConstraints.actionToastDurationMs)
        return
    }
    if (!validateRequiredDraftFields() || !canSubmit.value) return

    formError.value = ''
    checkingStorage.value = true
    try {
        const readiness = await analysisSubmission.assess(currentSubmissionInput(config))
        if (readiness.kind === 'storage_warning') {
            capacityWarning.value = readiness.capacity
            return
        }
        checkingStorage.value = false
        await submitDraftWithPersistence(readiness.persistHistory)
    } catch (error) {
        if (error instanceof LocalVideoEvidenceError) {
            formError.value = t('workspace.video.evidenceSaveFailed')
        } else if (!startDraftCooldown(error)) {
            formError.value = formatError(error)
        }
    } finally {
        checkingStorage.value = false
    }
}

/** 处理用户对存储容量警告的选择 */
function chooseStorageAction(choice: InsufficientStorageChoice) {
    const warning = capacityWarning.value
    capacityWarning.value = null
    if (!warning) {
        return
    }

    const decision = resolveStorageSubmission(warning, choice)
    if (decision.action === 'manage_history') {
        emit('manage-history')
        return
    }
    if (decision.action === 'submit') {
        void submitDraftWithPersistence(decision.persistHistory)
    }
}

/** 按本地持久化选择提交正式任务 */
async function submitDraftWithPersistence(persistHistory: boolean) {
    const config = taskConfig.value
    if (
        !canRequestAnalysis.value ||
        pendingConversationTurn.value !== null ||
        previewing.value ||
        submitting.value ||
        !config ||
        (mode.value === 'agent' && !isDraftRevisionConfirmed(confirmationRevision))
    ) {
        return
    }

    if (!validateRequiredDraftFields() || !canSubmit.value) return

    formError.value = ''
    submitting.value = true
    emit('submission-state-change', true)
    try {
        const persistence = conversationPersistence
        let historyImages: File[] = []
        if (persistHistory) {
            if (!persistence || !(await persistCurrentConversation())) {
                throw new AnalysisConversationPersistenceError('storage_unavailable')
            }
            historyImages = await persistence.readImages(activeDraftImages(draft))
        }
        if (
            persistHistory &&
            draft.contentKind === 'video' &&
            draft.video?.videoId &&
            props.ownerUserId
        ) {
            const preservation = await preserveVideoEvidenceLocally(
                draft.video.videoId,
                new LocalVideoEvidenceManager(props.ownerUserId),
                browserVideoEvidenceTransferClient,
                { estimateCapacity: estimateBrowserStorageCapacity },
            )
            if (preservation.kind === 'storage_warning') {
                capacityWarning.value = preservation.capacity
                return
            }
        }
        await access.refresh()
        const blocked = access.submissionBlockMessage(accessInput.value)
        if (blocked) {
            formError.value = blocked
            return
        }

        const submission = await analysisSubmission.submit(
            currentSubmissionInput(config),
            persistHistory,
        )
        if (!submission.task) {
            formError.value = submission.acceptance.message ?? t('workspace.genericError')
            return
        }

        const historySaved = await props.acceptSubmittedTask(
            submission.task,
            historyImages,
            persistHistory,
        )
        if (persistence && (!persistHistory || historySaved)) {
            try {
                await conversationPersistenceWrite
                await persistence.clear()
            } catch {
                failConversationPersistence()
            }
        }
        resetDraft()
        draftPreview.value = null
        resetAgentConversation()
    } catch (error) {
        if (error instanceof AnalysisConversationPersistenceError) {
            failConversationPersistence(true, error)
        } else if (error instanceof LocalVideoEvidenceError) {
            formError.value = t('workspace.video.evidenceSaveFailed')
        } else if (!startDraftCooldown(error)) {
            formError.value = formatError(error)
        }
    } finally {
        emit('submission-state-change', false)
        submitting.value = false
    }
}

const context: AnalysisComposerContext = {
    mediaRequirement,
    mediaRequirementMessage,
    mode,
    agentInteractionMode,
    operationsLocked,
    conversationSyncMessage,
    conversationTokenBudget,
    conversationAuthorityPending,
    agentSendAvailable,
    taskConfig,
    imageUploadLimits,
    videoUnavailableMessage,
    draft,
    draftPreview,
    previewing,
    submitting,
    checkingStorage,
    formError,
    agentMessages,
    agentComposerText,
    agentTyping,
    hasAgentReplyContext,
    agentConfirmationVisible,
    agentConfirmationCurrent,
    hasTaskSessionContent,
    trackLocked,
    selectedTrackId,
    selectedCustomTrackName,
    selectedTrackLabel,
    canRequestAnalysis,
    canSubmit,
    submissionHint,
    submissionActionLabel,
    accessBlockMessage,
    visibleConfiguredFields,
    coreConfiguredFields,
    secondaryConfiguredFields,
    resolvedField,
    formatFieldValue,
    invalidatePreview,
    updateDraftField,
    updateTrackSelection,
    updateCustomTrackName,
    updateContentKind,
    updateDraftImages,
    uploadDraftImages: draftImageUpload.upload,
    retryDraftImage: draftImageUpload.retry,
    updateDraftCover,
    updateDraftVideo,
    clearDraftMediaAfterUploadLimit,
    updateAgentComposerText,
    sendAgentTurn,
    adjustAgentDraft,
    requestClearConversation,
    previewDraft,
    submitDraft,
}

provide(analysisComposerKey, context)

defineExpose({ requestClearConversation, discardCompletedTaskConversation, operationsLocked })
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
        <ToastMessage :visible="Boolean(mediaSubmitToast)" :message="mediaSubmitToast" />
        <ToastMessage
            :visible="conversationExpiredToastVisible"
            :message="t('workspace.agentChat.conversationExpired')"
        />
        <AnalysisStorageCapacityDialog :warning="capacityWarning" @choose="chooseStorageAction" />

        <AppConfirmDialog
            :open="clearConversationConfirmationOpen"
            :title="t('workspace.agentChat.clearConfirmTitle')"
            :description="
                pendingNewTaskContentKind
                    ? t('workspace.agentChat.clearForContentKind')
                    : t('workspace.agentChat.clearConfirmDescription')
            "
            :confirm-label="t('workspace.agentChat.clearConfirmAction')"
            :cancel-label="t('common.cancel')"
            tone="danger"
            @update:open="clearConversationConfirmationOpen = $event"
            @confirm="confirmClearConversation"
            @cancel="cancelClearConversation"
        />
    </div>
</template>
