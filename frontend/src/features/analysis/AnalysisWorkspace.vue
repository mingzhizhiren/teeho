<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import { cleanupAnalysisTaskAssets, getAnalysisTaskConfig } from '@/api/analysis'
import AppConfirmDialog from '@/components/AppConfirmDialog.vue'
import InlineFeedback from '@/components/feedback/InlineFeedback.vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import ToastMessage from '@/components/ToastMessage.vue'
import { useUserStorage } from '@/composables/useUserStorage'
import { parseCompletionResultTarget } from '@/features/notifications/browserNotifications'
import { useOnboardingCoordinator } from '@/features/onboarding/onboarding.context'
import { isOnboardingChapterTargetAvailable } from '@/features/onboarding/onboarding.targets'
import { useOnboardingBlocker } from '@/features/onboarding/useOnboardingBlocker'
import { useAuthStore } from '@/stores/auth'
import { getFrontendRuntime } from '@/edition/runtime'
import { retryTransientRead } from '@/utils/retryTransientRead'
import { getAppConfig, updateAppConfig } from '@/utils/appConfig'
import { getApiRequestErrorMessage } from '@/utils/apiRequestError'
import AnalysisAgentComposer from './AnalysisAgentComposer.vue'
import AnalysisComposerMain from './AnalysisComposerMain.vue'
import AnalysisHistoryDrawer from './AnalysisHistoryDrawer.vue'
import AnalysisResultPanel from './AnalysisResultPanel.vue'
import AnalysisRitualPrototype, { type AnalysisRitualPhase } from './AnalysisRitualPrototype.vue'
import type { AnalysisRitualVariant } from './analysis.ritual'
import {
    ANALYSIS_RITUAL_ASSIGNMENT_STORAGE_KEY,
    analysisRitualAssignmentSchema,
    createAnalysisRitualAssignmentManager,
} from './analysis.ritual-assignment'
import AnalysisTaskComposer from './AnalysisTaskComposer.vue'
import AnalysisTaskStatus from './AnalysisTaskStatus.vue'
import AnalysisWorkspaceSidebar from './AnalysisWorkspaceSidebar.vue'
import AnalysisWorkspaceLoading from './AnalysisWorkspaceLoading.vue'
import { analysisUiConstraints } from './analysis.constants'
import { createAnalysisOnboardingEventReporter } from './analysis.onboarding'
import type { AnalysisInputMode, AnalysisTask, AnalysisTaskConfig } from './analysis.contract'
import { createBrowserAnalysisConversationPersistence } from './analysis.conversation-persistence.browser'
import {
    canDeleteAnalysisLocalHistory,
    findActiveAnalysisTask,
    isActiveAnalysisTaskStatus,
} from './analysis.task-status'
import { browserAnalysisTaskLifecycleAdapter } from './analysis.lifecycle.adapter'
import { createAnalysisResultActions } from './analysis.result-actions'
import { createLocalHistoryName, hasCompleteLocalHistoryImages } from './localHistory'
import { activeDraftImages } from './taskDraft'
import { useAnalysisLocalHistory } from './useAnalysisLocalHistory'
import { useAnalysisTaskLifecycle } from './useAnalysisTaskLifecycle'
import { useAnalysisReanalysisIntents, ReanalysisIntentError } from './useAnalysisReanalysisIntents'
import {
    analysisSubmissionIntentKey,
    useAnalysisSubmissionIntents,
} from './useAnalysisSubmissionIntents'
import { useWorkspaceEventsStore } from '@/stores/workspaceEvents'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const onboardingCoordinator = useOnboardingCoordinator()
const onboardingEventReporter = createAnalysisOnboardingEventReporter(onboardingCoordinator)
const workspaceEvents = useWorkspaceEventsStore()
const userStorage = useUserStorage()
const ritualAssignmentManager = createAnalysisRitualAssignmentManager({
    get: () =>
        userStorage.getValue(
            ANALYSIS_RITUAL_ASSIGNMENT_STORAGE_KEY,
            analysisRitualAssignmentSchema,
        ),
    set: (assignment) => userStorage.setValue(ANALYSIS_RITUAL_ASSIGNMENT_STORAGE_KEY, assignment),
})
const analysisLocalHistory = useAnalysisLocalHistory({
    userId: computed(() => auth.user?.id ?? null),
    errorMessage: (operation) => t(`workspace.localHistory.${operation}Failed`),
})
const submissionIntents = useAnalysisSubmissionIntents()
provide(analysisSubmissionIntentKey, submissionIntents)
const mode = ref<AnalysisInputMode>(getAppConfig().analysisInputMode)
const activeView = ref<AnalysisInputMode | 'result'>(mode.value)
const resultViewContext = ref<'current' | 'history'>('current')
const taskConfig = ref<AnalysisTaskConfig | null>(null)
const localHistoryRecords = analysisLocalHistory.records
const loadingLatest = ref(true)
const workspaceInitializationFailed = ref(false)
const composerInitializationSettled = ref(false)
const abandonConfirmOpen = ref(false)
const historyDeleteConfirmOpen = ref(false)
const pendingHistoryDeleteTaskId = ref<string | null>(null)
const deletingHistoryTaskId = ref<string | null>(null)
const clock = ref(Date.now())
const workspaceError = ref('')
const historyActionError = ref('')
const ritualTaskId = ref<string | null>(null)
const selectedRitualVariant = ref<AnalysisRitualVariant>('A')
const ritualVariantReady = ref(false)
let ritualVariantBindingVersion = 0
let ritualVariantBindingPromise: Promise<void> | null = null
let historyExcludedTaskIds = new Set<string>()
let pendingSubmittedImages: {
    readonly submissionId: string
    readonly inputFingerprint: string
    readonly assetIds: readonly string[]
    readonly files: readonly File[]
} | null = null
let pendingSubmittedImagesWrite: Promise<void> | null = null
const taskLifecycle = useAnalysisTaskLifecycle(
    {
        historyRecords: localHistoryRecords,
        submissionIntents: submissionIntents.intents,
        reanalysisIntents: useAnalysisReanalysisIntents(),
        persistHistory: (taskToPersist, sourceTaskId) =>
            persistHistoryTask(taskToPersist, undefined, sourceTaskId),
        removeHistory: (taskToRemove) => excludeHistoryTask(taskToRemove),
        setError: (message) => {
            workspaceError.value = message
        },
        formatError: (error) =>
            error instanceof ReanalysisIntentError
                ? t('workspace.checkup.reanalysisStateUnavailable')
                : getApiRequestErrorMessage(error, t('workspace.genericError')),
    },
    browserAnalysisTaskLifecycleAdapter,
)
const tasks = taskLifecycle.tasks
const task = taskLifecycle.currentTask
const lifecycleBusy = taskLifecycle.actionBusy
const localHistoryError = analysisLocalHistory.error
const historyQuery = ref('')
const historyOpen = ref(false)
const historyTrigger = ref<HTMLButtonElement | null>(null)
const taskComposer = ref<{
    operationsLocked: boolean
    requestClearConversation: () => void
    discardCompletedTaskConversation: (completedTask: AnalysisTask) => Promise<boolean>
} | null>(null)
const draftSessionHasContent = ref(false)
const activeTaskWaitToastVisible = ref(false)
let clockTimer: ReturnType<typeof setInterval> | undefined
let activeTaskWaitToastTimer: ReturnType<typeof setTimeout> | undefined
const localHistoryNames = computed(
    () => new Map(localHistoryRecords.value.map((record) => [record.taskId, record.displayName])),
)
const selectedLocalHistoryRecord = computed(() => {
    const taskId = task.value?.id
    if (!taskId) return null
    return localHistoryRecords.value.find((record) => record.taskId === taskId) ?? null
})
const showWorkspaceLoading = computed(
    () =>
        loadingLatest.value ||
        (!workspaceInitializationFailed.value && !composerInitializationSettled.value),
)
const businessDialogOpen = computed(
    () => abandonConfirmOpen.value || historyDeleteConfirmOpen.value,
)
useOnboardingBlocker(showWorkspaceLoading, 'workspace_recovery')
useOnboardingBlocker(businessDialogOpen, 'business_dialog')
useOnboardingBlocker(historyOpen, 'business_drawer')
let reportedWorkspaceReadyAccountId: string | null = null

async function reportWorkspaceReady(): Promise<void> {
    const accountId = auth.user?.id ?? null
    if (
        !accountId ||
        accountId === reportedWorkspaceReadyAccountId ||
        showWorkspaceLoading.value ||
        businessDialogOpen.value ||
        historyOpen.value ||
        mode.value !== 'agent' ||
        activeView.value !== 'agent' ||
        typeof document === 'undefined'
    ) {
        return
    }
    await nextTick()
    if (
        accountId !== auth.user?.id ||
        !isOnboardingChapterTargetAvailable(document, 'workspace_foundation')
    ) {
        return
    }
    const result = onboardingCoordinator.notify({ type: 'workspace_ready' })
    if (result.status === 'queued' || result.reason === 'duplicate_event') {
        reportedWorkspaceReadyAccountId = accountId
    }
}
const showWorkspaceErrorAtModule = computed(
    () =>
        Boolean(workspaceError.value) &&
        (activeView.value !== 'result' || loadingLatest.value || !task.value),
)
const filteredTasks = computed(() => {
    const query = historyQuery.value.trim().toLocaleLowerCase()
    if (!query) {
        return tasks.value
    }

    return tasks.value.filter((historyTask) => {
        const searchableText = [
            localHistoryNames.value.get(historyTask.id) ?? createLocalHistoryName(historyTask),
            historyTask.standardTask.rawText,
            historyTask.standardTask.fields.title.value,
            historyTask.result?.qualitativeConclusion.summary,
            ...(historyTask.standardTask.fields.topics.value ?? []),
        ]
            .filter((value): value is string => typeof value === 'string')
            .join('\n')
            .toLocaleLowerCase()
        return searchableText.includes(query)
    })
})
const activeTaskCount = computed(
    () =>
        tasks.value.filter((historyTask) => isActiveAnalysisTaskStatus(historyTask.status)).length,
)
const activeTask = computed(
    () =>
        findActiveAnalysisTask(tasks.value) ??
        (task.value && isActiveAnalysisTaskStatus(task.value.status) ? task.value : null),
)
const resultFields = computed(() => {
    const fields = taskConfig.value?.fields ?? []
    return fields.filter((field) => task.value?.standardTask.fields[field.name] !== undefined)
})
const displayedResult = computed(() => task.value?.result ?? null)
const currentLocalHistoryDeleteBlocked = computed(() =>
    Boolean(task.value && !canDeleteAnalysisLocalHistory(task.value.status)),
)
const canReanalyze = computed(() => {
    const currentTask = task.value
    return (
        Boolean(displayedResult.value) &&
        currentTask !== null &&
        ['succeeded', 'technical_failed', 'insufficient_points', 'abandoned', 'cancelled'].includes(
            currentTask.status,
        )
    )
})
function beginRitualForTask(taskId: string): Promise<void> {
    if (ritualTaskId.value === taskId) {
        if (ritualVariantReady.value) return Promise.resolve()
        if (ritualVariantBindingPromise) return ritualVariantBindingPromise
    }

    ritualTaskId.value = taskId
    ritualVariantReady.value = false
    const bindingVersion = ++ritualVariantBindingVersion
    const bindingPromise = ritualAssignmentManager
        .getOrAssign(taskId)
        .then((variant) => {
            if (bindingVersion !== ritualVariantBindingVersion || ritualTaskId.value !== taskId) {
                return
            }
            selectedRitualVariant.value = variant
            ritualVariantReady.value = true
        })
        .finally(() => {
            if (ritualVariantBindingPromise === bindingPromise) {
                ritualVariantBindingPromise = null
            }
        })
    ritualVariantBindingPromise = bindingPromise
    return bindingPromise
}

function startResultTask(nextTask: AnalysisTask) {
    const actionMessage = workspaceError.value
    void beginRitualForTask(nextTask.id)
    selectTask(nextTask, 'current')
    workspaceError.value = actionMessage
}
const resultActions = createAnalysisResultActions({
    task,
    busy: lifecycleBusy,
    canRun: canReanalyze,
    reanalyzeCurrent: () => taskLifecycle.reanalyzeCurrent(),
    onTaskStarted: startResultTask,
})
const ritualPreviewEnabled = computed(() => import.meta.env.DEV && route.query.ritual === 'preview')
const ritualVariant = computed<AnalysisRitualVariant>(() => {
    if (!ritualPreviewEnabled.value) {
        return selectedRitualVariant.value
    }
    const requestedVariant = route.query.variant
    return requestedVariant === 'B' || requestedVariant === 'C' ? requestedVariant : 'A'
})
const ritualVisible = computed(
    () =>
        task.value !== null &&
        task.value.id === ritualTaskId.value &&
        ritualVariantReady.value &&
        (isActiveAnalysisTaskStatus(task.value.status) || task.value.status === 'succeeded'),
)
const ritualPhase = computed<AnalysisRitualPhase>(() => {
    if (task.value?.status === 'succeeded') {
        return 'reveal'
    }
    if (task.value?.status === 'queued') {
        return 'ignition'
    }
    return 'forge'
})
/** 收尾完成后显示任务的真实分析结果。 */
async function revealRitualResult() {
    const revealedTask = task.value
    if (revealedTask?.id === ritualTaskId.value && revealedTask.status === 'succeeded') {
        ritualTaskId.value = null
        ritualVariantReady.value = false
        ritualVariantBindingVersion += 1
        if (resultViewContext.value !== 'current' || revealedTask.resultVersion === null) {
            return
        }
        await nextTick()
        onboardingEventReporter.reportAnalysisResult({
            taskId: revealedTask.id,
            resultVersion: revealedTask.resultVersion,
            origin: 'new',
            targetsReady:
                task.value?.id === revealedTask.id &&
                resultViewContext.value === 'current' &&
                isOnboardingChapterTargetAvailable(document, 'analysis_result'),
        })
    }
}

/** 切换工作台输入模式 */
function setMode(nextMode: AnalysisInputMode) {
    mode.value = nextMode
    activeView.value = nextMode
    updateAppConfig({ analysisInputMode: nextMode })
    if (parseCompletionResultTarget(route.query.task)) {
        void router.replace({ name: 'workspace' })
    }
}

/** 在 Agent 和定制输入模式之间切换 */
async function toggleMode() {
    if (taskComposer.value?.operationsLocked) return
    const previousMode = mode.value
    const nextMode = previousMode === 'agent' ? 'custom' : 'agent'
    setMode(nextMode)
    if (previousMode !== 'agent' || nextMode !== 'custom') return
    const entryId = crypto.randomUUID()
    await nextTick()
    onboardingEventReporter.reportExpertMode({
        entryId,
        origin: 'new',
        targetsReady:
            mode.value === 'custom' &&
            activeView.value === 'custom' &&
            isOnboardingChapterTargetAvailable(document, 'expert_mode'),
    })
}

/** 打开移动端任务编辑区域 */
async function openComposer() {
    if (activeTask.value) {
        selectTask(activeTask.value, 'current')
        showActiveTaskWaitToast()
        return
    }
    if (task.value) {
        await taskComposer.value?.discardCompletedTaskConversation(task.value)
    }
    workspaceError.value = ''
    historyActionError.value = ''
    activeView.value = mode.value
    if (parseCompletionResultTarget(route.query.task)) {
        void router.replace({ name: 'workspace' })
    }
}

/** 提示当前账号必须先等待活动任务完成。 */
function showActiveTaskWaitToast() {
    activeTaskWaitToastVisible.value = true
    if (activeTaskWaitToastTimer) {
        clearTimeout(activeTaskWaitToastTimer)
    }
    activeTaskWaitToastTimer = setTimeout(() => {
        activeTaskWaitToastVisible.value = false
        activeTaskWaitToastTimer = undefined
    }, analysisUiConstraints.actionToastDurationMs)
}

/** 打开移动端历史任务抽屉 */
function openHistoryDrawer() {
    historyOpen.value = true
}

/** 打开本地历史管理界面 */
function manageLocalHistory() {
    historyQuery.value = ''
    if (window.matchMedia('(max-width: 1023px)').matches) {
        openHistoryDrawer()
    }
}

/** 选择任务并关闭移动端历史抽屉 */
function selectTask(selectedTask: AnalysisTask, viewContext: 'current' | 'history' = 'history') {
    workspaceError.value = ''
    historyActionError.value = ''
    taskLifecycle.select(selectedTask)
    resultViewContext.value = viewContext
    activeView.value = 'result'
    const routeTarget = parseCompletionResultTarget(route.query.task)
    if (routeTarget && routeTarget.taskId !== selectedTask.id) {
        void router.replace({ name: 'workspace' })
    }
}

/** 生成本地历史读写失败提示 */
function localHistoryErrorMessage(operation: 'read' | 'write') {
    return t(`workspace.localHistory.${operation}Failed`)
}

/** 判断任务是否存在于本地历史 */
function isTaskSavedLocally(taskId: string) {
    return analysisLocalHistory.isSaved(taskId)
}

function dismissWorkspaceError() {
    workspaceError.value = ''
}

function dismissHistoryActionError() {
    historyActionError.value = ''
}

/** 请求确认删除当前本地历史 */
function requestDeleteCurrentLocalHistory() {
    const selectedTask = task.value
    if (
        !selectedTask ||
        !canDeleteAnalysisLocalHistory(selectedTask.status) ||
        !analysisLocalHistory.available.value ||
        deletingHistoryTaskId.value ||
        !isTaskSavedLocally(selectedTask.id)
    ) {
        return
    }

    pendingHistoryDeleteTaskId.value = selectedTask.id
    historyDeleteConfirmOpen.value = true
}

/** 确认后删除当前本地历史及云端临时素材 */
async function confirmDeleteCurrentLocalHistory() {
    const taskId = pendingHistoryDeleteTaskId.value
    const selectedTask = tasks.value.find((candidate) => candidate.id === taskId)
    historyDeleteConfirmOpen.value = false
    pendingHistoryDeleteTaskId.value = null
    if (
        !taskId ||
        !selectedTask ||
        !canDeleteAnalysisLocalHistory(selectedTask.status) ||
        !analysisLocalHistory.available.value ||
        deletingHistoryTaskId.value
    ) {
        return
    }

    deletingHistoryTaskId.value = selectedTask.id
    historyActionError.value = ''
    const cloudCleanupRequest = cleanupAnalysisTaskAssets(selectedTask.id).catch(() => null)
    try {
        await analysisLocalHistory.remove(selectedTask.id)
        taskLifecycle.retainAfterLocalDelete(selectedTask)
        await cloudCleanupRequest
    } catch {
        historyActionError.value = localHistoryErrorMessage('write')
    } finally {
        deletingHistoryTaskId.value = null
    }
}

/** 根据当前路由打开对应任务 */
async function openTaskFromRoute() {
    const target = parseCompletionResultTarget(route.query.task)
    if (!target) {
        return
    }

    try {
        const selectedTask = await taskLifecycle.openTrackedTask(target.taskId)
        if (!selectedTask) {
            workspaceError.value = t('notifications.resultUnavailable')
            return
        }
        selectTask(selectedTask, 'current')
    } catch (error) {
        workspaceError.value = getApiRequestErrorMessage(error, t('workspace.genericError'))
    }
}

/** 同步任务提交中的忙碌状态 */
function handleSubmissionStateChange() {
    taskLifecycle.invalidatePendingRefresh()
}

/** 初次恢复完成或明确失败前，全屏 Loading 始终作为交互屏障。 */
function handleComposerInitializationState(state: 'loading' | 'ready' | 'error') {
    if (state !== 'loading') composerInitializationSettled.value = true
}

/** 登记新提交任务并安排本地保存 */
async function handleSubmittedTask(
    submittedTask: AnalysisTask,
    originalImages: File[],
    persistHistory: boolean,
) {
    taskLifecycle.invalidatePendingRefresh()
    taskLifecycle.registerSubmitted(submittedTask, persistHistory)
    void beginRitualForTask(submittedTask.id)
    selectTask(submittedTask, 'current')
    if (persistHistory) {
        return persistSubmittedTask(submittedTask, originalImages)
    } else {
        await forgetTaskSubmissionIntents(submittedTask)
        return true
    }
}

/** 清除与同一后端任务或活动输入匹配的提交意图。 */
async function forgetTaskSubmissionIntents(taskToForget: AnalysisTask) {
    const matchingIntentIds = submissionIntents.intents.value
        .filter(
            (intent) =>
                intent.submissionId === taskToForget.id ||
                intent.inputFingerprint === taskToForget.inputFingerprint,
        )
        .map((intent) => intent.submissionId)
    await Promise.all(
        matchingIntentIds.map((submissionId) => submissionIntents.forget(submissionId)),
    )
}

/** 排除不应进入历史的任务，并清除可能已完成的并发保存。 */
async function excludeHistoryTask(taskToExclude: AnalysisTask) {
    historyExcludedTaskIds = new Set([...historyExcludedTaskIds, taskToExclude.id])
    await Promise.all([
        analysisLocalHistory.isSaved(taskToExclude.id)
            ? analysisLocalHistory.remove(taskToExclude.id)
            : Promise.resolve(),
        forgetTaskSubmissionIntents(taskToExclude),
    ])
}

/** 保存仍符合历史条件的任务，并处理保存期间收到的排除状态。 */
async function persistHistoryTask(
    taskToPersist: AnalysisTask,
    originalImages?: File[],
    sourceTaskId?: string,
) {
    if (
        taskToPersist.status === 'insufficient_points' ||
        historyExcludedTaskIds.has(taskToPersist.id)
    ) {
        return
    }
    const record = sourceTaskId
        ? await analysisLocalHistory.saveFromTask(taskToPersist, sourceTaskId)
        : await analysisLocalHistory.save(taskToPersist, originalImages)
    if (hasCompleteLocalHistoryImages(record)) {
        await forgetTaskSubmissionIntents(taskToPersist)
    }
    if (historyExcludedTaskIds.has(taskToPersist.id)) {
        await analysisLocalHistory.remove(taskToPersist.id)
    }
}

/** 把已提交任务及原图保存到本地历史 */
async function persistSubmittedTask(submittedTask: AnalysisTask, originalImages: File[]) {
    try {
        await persistHistoryTask(submittedTask, originalImages)
        localHistoryError.value = ''
        return true
    } catch {
        taskLifecycle.markSessionOnly(submittedTask.id)
        localHistoryError.value = localHistoryErrorMessage('write')
        return false
    }
}

/** 页面刷新打断任务受理响应时，先从尚未清理的会话密文中保住已就绪原图。 */
async function capturePendingSubmittedImages() {
    const userId = auth.user?.id
    const manager = userStorage.files.value
    const intent = submissionIntents.intents.value.find((candidate) => candidate.persistHistory)
    if (!userId || !manager || !intent) return

    const persistence = await createBrowserAnalysisConversationPersistence({ userId, manager })
    try {
        const restored = await persistence.restore()
        if (restored.status !== 'restored') {
            return
        }
        const images = activeDraftImages(restored.snapshot.draft)
        const assetIds = images.flatMap((image) =>
            image.status === 'ready' && image.assetId ? [image.assetId] : [],
        )
        if (images.length === 0 || assetIds.length !== images.length) return
        pendingSubmittedImages = {
            submissionId: intent.submissionId,
            inputFingerprint: intent.inputFingerprint,
            assetIds,
            files: images.map((image) => image.file),
        }
    } finally {
        persistence.close()
    }
}

function hasSameImageReferences(taskToMatch: AnalysisTask, assetIds: readonly string[]) {
    if (taskToMatch.standardTask.contentKind === 'video') {
        return assetIds.length === 1 && taskToMatch.standardTask.coverReference === assetIds[0]
    }
    const taskReferences = taskToMatch.standardTask.imageReferences
    return (
        taskReferences.length === assetIds.length &&
        taskReferences.every((reference, index) => reference === assetIds[index])
    )
}

/** 服务端任务出现后，把刷新前暂存的原图补写进同一条本地历史。 */
function recoverPendingSubmittedImages() {
    const pending = pendingSubmittedImages
    if (!pending || pendingSubmittedImagesWrite) return pendingSubmittedImagesWrite
    const matchingTask = tasks.value.find(
        (candidate) =>
            (candidate.id === pending.submissionId ||
                candidate.inputFingerprint === pending.inputFingerprint) &&
            hasSameImageReferences(candidate, pending.assetIds),
    )
    if (!matchingTask) return null

    pendingSubmittedImagesWrite = persistHistoryTask(matchingTask, [...pending.files])
        .then(() => {
            if (pendingSubmittedImages === pending) pendingSubmittedImages = null
            localHistoryError.value = ''
        })
        .catch(() => {
            localHistoryError.value = localHistoryErrorMessage('write')
        })
        .finally(() => {
            pendingSubmittedImagesWrite = null
        })
    return pendingSubmittedImagesWrite
}

/** 请求通过定制弹窗确认放弃当前活动任务。 */
function requestAbandon() {
    if (!task.value || lifecycleBusy.value || !isActiveAnalysisTaskStatus(task.value.status)) {
        return
    }
    abandonConfirmOpen.value = true
}

/** 确认后放弃当前活动任务；若结果已先完成则生命周期会展示成功事实。 */
async function confirmAbandon() {
    if (!task.value || lifecycleBusy.value || !isActiveAnalysisTaskStatus(task.value.status)) {
        abandonConfirmOpen.value = false
        return
    }
    abandonConfirmOpen.value = false
    await taskLifecycle.abandonCurrent()
}

/** 重试当前失败任务 */
async function retryCurrentTask() {
    await taskLifecycle.retryCurrent()
}

onMounted(async () => {
    try {
        await Promise.all([analysisLocalHistory.load(), submissionIntents.load()])
        await capturePendingSubmittedImages()
        await Promise.all([
            retryTransientRead(getAnalysisTaskConfig).then((response) => {
                taskConfig.value = response.data.data.config
            }),
            retryTransientRead(() => taskLifecycle.initialize()),
            getFrontendRuntime().useAnalysisAccess().refresh(),
        ])
        await recoverPendingSubmittedImages()
        if (task.value && isActiveAnalysisTaskStatus(task.value.status)) {
            await beginRitualForTask(task.value.id)
            selectTask(task.value, 'current')
        }
        await openTaskFromRoute()
    } catch (error) {
        workspaceInitializationFailed.value = true
        workspaceError.value = getApiRequestErrorMessage(error, t('workspace.genericError'))
    } finally {
        loadingLatest.value = false
    }

    taskLifecycle.activate()
    clockTimer = setInterval(() => {
        clock.value = Date.now()
    }, analysisUiConstraints.clockRefreshIntervalMs)
})

watch(
    () => route.query.task,
    () => {
        void openTaskFromRoute()
    },
)

watch(
    [
        () => auth.user?.id ?? null,
        showWorkspaceLoading,
        businessDialogOpen,
        historyOpen,
        mode,
        activeView,
    ],
    () => void reportWorkspaceReady(),
    { immediate: true, flush: 'post' },
)

watch(
    () => workspaceEvents.taskRevision,
    () => {
        void taskLifecycle.refresh(true).then(() => recoverPendingSubmittedImages())
    },
)

watch(
    () => tasks.value.map((candidate) => `${candidate.id}:${candidate.updatedAt}`).join('|'),
    () => void recoverPendingSubmittedImages(),
)

watch(
    () => [task.value?.id, task.value?.status] as const,
    ([taskId, status]) => {
        if (taskId && status && isActiveAnalysisTaskStatus(status)) {
            void beginRitualForTask(taskId)
            if (activeView.value !== 'result' && task.value) {
                selectTask(task.value, 'current')
            }
        } else if (taskId !== ritualTaskId.value || status !== 'succeeded') {
            ritualTaskId.value = null
            ritualVariantReady.value = false
            ritualVariantBindingVersion += 1
        }
    },
    { immediate: true },
)

onBeforeUnmount(() => {
    taskLifecycle.deactivate()
    if (clockTimer) {
        clearInterval(clockTimer)
    }
    if (activeTaskWaitToastTimer) {
        clearTimeout(activeTaskWaitToastTimer)
    }
})
</script>

<template>
    <section
        class="analysis-workspace-shell mx-auto grid w-full max-w-screen-2xl gap-4 px-5 py-4 sm:p-6 lg:min-h-[calc(100dvh-4rem)] lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-5"
    >
        <AnalysisWorkspaceLoading v-if="showWorkspaceLoading" />

        <AnalysisWorkspaceSidebar
            v-else
            :mode="mode"
            :tasks="filteredTasks"
            :display-names="localHistoryNames"
            :selected-task-id="activeView === 'result' ? (task?.id ?? null) : null"
            :loading="loadingLatest"
            :error="localHistoryError"
            :query="historyQuery"
            :draft-session-has-content="draftSessionHasContent"
            :draft-session-locked="taskComposer?.operationsLocked ?? true"
            @compose="openComposer"
            @clear-draft="taskComposer?.requestClearConversation()"
            @select="selectTask"
            @update:query="historyQuery = $event"
        />

        <AnalysisTaskComposer
            v-if="!loadingLatest"
            v-show="!showWorkspaceLoading"
            ref="taskComposer"
            :mode="mode"
            :task-config="taskConfig"
            :owner-user-id="auth.user?.id ?? null"
            :accept-submitted-task="handleSubmittedTask"
            @manage-history="manageLocalHistory"
            @submission-state-change="handleSubmissionStateChange"
            @session-content-change="draftSessionHasContent = $event"
            @initialization-state-change="handleComposerInitializationState"
        >
            <div class="analysis-workspace-column flex min-h-0 min-w-0 flex-1 flex-col gap-4">
                <main
                    class="analysis-workspace-main order-1 min-h-0 flex-1 overflow-y-auto rounded-3xl border border-line bg-surface shadow-sm"
                >
                    <div class="p-5 sm:p-7 lg:p-8">
                        <div
                            class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
                        >
                            <div v-if="activeView !== 'result'">
                                <p
                                    class="text-xs font-semibold uppercase tracking-[0.2em] text-brand"
                                >
                                    {{ t('workspace.eyebrow') }}
                                </p>
                                <h1 class="mt-2 text-2xl font-semibold tracking-tight text-ink">
                                    {{ t(`workspace.viewTitles.${activeView}`) }}
                                </h1>
                                <p
                                    v-if="activeView === 'agent'"
                                    class="mt-2 max-w-2xl text-sm leading-6 text-muted"
                                >
                                    {{ t(`workspace.modeDescriptions.${activeView}`) }}
                                </p>
                            </div>
                            <div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
                                <button
                                    ref="historyTrigger"
                                    class="inline-flex min-h-10 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-xs font-semibold text-ink transition hover:border-brand/40 hover:bg-brand/5 lg:hidden"
                                    type="button"
                                    :aria-label="t('workspace.history.open')"
                                    aria-haspopup="dialog"
                                    :aria-expanded="historyOpen"
                                    data-testid="history-trigger"
                                    @click="openHistoryDrawer"
                                >
                                    <AppIcon class="text-brand" name="history" size="sm" />
                                    <span>{{ t('workspace.history.button') }}</span>
                                    <span
                                        v-if="activeTaskCount"
                                        class="min-w-5 rounded-full bg-brand px-1.5 text-center text-[10px] leading-5 text-on-brand"
                                        :aria-label="
                                            t('workspace.history.activeCount', {
                                                count: activeTaskCount,
                                            })
                                        "
                                    >
                                        {{ activeTaskCount }}
                                    </span>
                                </button>
                                <button
                                    v-if="activeView !== 'result'"
                                    v-guide-anchor="'onboarding.workspace.mode'"
                                    class="group flex min-h-10 items-center rounded-xl border border-line bg-surface-muted p-1 text-xs font-semibold text-muted transition hover:border-brand/40"
                                    type="button"
                                    role="switch"
                                    :aria-checked="mode === 'custom'"
                                    :aria-label="t('workspace.modeToggleLabel')"
                                    data-testid="mode-toggle"
                                    :disabled="taskComposer?.operationsLocked ?? true"
                                    @click="toggleMode"
                                >
                                    <span
                                        class="rounded-lg px-3 py-2 transition"
                                        :class="
                                            mode === 'agent'
                                                ? 'bg-surface text-ink shadow-sm ring-1 ring-line'
                                                : ''
                                        "
                                    >
                                        {{ t('workspace.modes.agent') }}
                                    </span>
                                    <span
                                        class="rounded-lg px-3 py-2 transition"
                                        :class="
                                            mode === 'custom'
                                                ? 'bg-surface text-ink shadow-sm ring-1 ring-line'
                                                : ''
                                        "
                                    >
                                        {{ t('workspace.modes.custom') }}
                                    </span>
                                </button>
                                <div
                                    v-if="activeView === 'result' && task"
                                    class="flex flex-wrap items-center justify-end gap-2"
                                >
                                    <button
                                        v-if="!isActiveAnalysisTaskStatus(task.status)"
                                        class="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink transition hover:border-brand/40 hover:bg-brand/5"
                                        type="button"
                                        @click="openComposer"
                                    >
                                        {{ t('workspace.newTask') }}
                                    </button>
                                    <button
                                        v-if="isTaskSavedLocally(task.id)"
                                        class="rounded-lg border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-400/30 dark:text-red-300 dark:hover:bg-red-400/10"
                                        type="button"
                                        :disabled="
                                            currentLocalHistoryDeleteBlocked ||
                                                deletingHistoryTaskId === task.id
                                        "
                                        @click="requestDeleteCurrentLocalHistory"
                                    >
                                        {{
                                            currentLocalHistoryDeleteBlocked
                                                ? t('workspace.localHistory.deleteAfterAnalysis')
                                                : deletingHistoryTaskId === task.id
                                                    ? t('workspace.localHistory.deleting')
                                                    : t('workspace.localHistory.delete')
                                        }}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <InlineFeedback
                            v-if="historyActionError"
                            class="mt-3 sm:ml-auto sm:max-w-md"
                            compact
                            :feedback="{
                                key: 'analysis.local-history.delete',
                                scope: 'module',
                                tone: 'error',
                                message: historyActionError,
                                announce: 'assertive',
                            }"
                            dismiss-policy="after-interaction"
                            @dismiss="dismissHistoryActionError"
                        />

                        <InlineFeedback
                            v-if="showWorkspaceErrorAtModule"
                            class="mt-5"
                            :feedback="{
                                key: 'workspace.analysis.operation',
                                scope: 'module',
                                tone: 'error',
                                message: workspaceError,
                                announce: 'assertive',
                            }"
                        />

                        <AnalysisRitualPrototype
                            v-if="ritualPreviewEnabled"
                            phase="forge"
                            :variant="ritualVariant"
                            preview
                        />

                        <template v-else>
                            <AnalysisComposerMain :active-view="activeView" />

                            <div v-if="activeView === 'result'">
                                <div
                                    v-if="!task"
                                    class="mt-7 flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface-muted px-6 text-center"
                                >
                                    <div
                                        class="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-xl"
                                    >
                                        <AppIcon name="sparkles" />
                                    </div>
                                    <h2 class="mt-4 text-base font-semibold text-ink">
                                        {{ t('workspace.emptyResultTitle') }}
                                    </h2>
                                    <p class="mt-2 max-w-sm text-sm leading-6 text-muted">
                                        {{ t('workspace.emptyResultDescription') }}
                                    </p>
                                </div>

                                <AnalysisRitualPrototype
                                    v-else-if="ritualVisible && task"
                                    :key="task.id"
                                    :phase="ritualPhase"
                                    :variant="ritualVariant"
                                    :started-at="task.startedAt"
                                    :retrying="task.status === 'retrying'"
                                    :abandonable="isActiveAnalysisTaskStatus(task.status)"
                                    :busy="lifecycleBusy"
                                    @abandon="requestAbandon"
                                    @revealed="revealRitualResult"
                                />

                                <AnalysisTaskStatus
                                    v-else-if="task.status !== 'succeeded' && !displayedResult"
                                    :task="task"
                                    :busy="lifecycleBusy"
                                    :clock="clock"
                                    :action-error="workspaceError"
                                    show-usual-duration
                                    @abandon="requestAbandon"
                                    @retry="retryCurrentTask"
                                    @dismiss-error="dismissWorkspaceError"
                                />

                                <template v-else-if="displayedResult">
                                    <AnalysisTaskStatus
                                        v-if="task.status !== 'succeeded'"
                                        :task="task"
                                        :busy="lifecycleBusy"
                                        :clock="clock"
                                        :action-error="workspaceError"
                                        @abandon="requestAbandon"
                                        @retry="retryCurrentTask"
                                        @dismiss-error="dismissWorkspaceError"
                                    />

                                    <AnalysisResultPanel
                                        :task="task"
                                        :result-fields="resultFields"
                                        :tracks="taskConfig?.tracks ?? []"
                                        :can-reanalyze="canReanalyze"
                                        :busy="lifecycleBusy"
                                        :clock="clock"
                                        :action-error="
                                            task.status === 'succeeded' ? workspaceError : ''
                                        "
                                        :view-context="resultViewContext"
                                        :history-record="selectedLocalHistoryRecord"
                                        :load-original-image="analysisLocalHistory.getOriginalImage"
                                        @reanalyze="resultActions.reanalyze"
                                        @dismiss-error="dismissWorkspaceError"
                                    />
                                </template>
                            </div>
                        </template>
                    </div>
                </main>

                <AnalysisAgentComposer :visible="mode === 'agent' && activeView !== 'result'" />
            </div>
        </AnalysisTaskComposer>
    </section>

    <ToastMessage :visible="activeTaskWaitToastVisible" :message="t('workspace.activeTaskWait')" />

    <AnalysisHistoryDrawer
        v-model:open="historyOpen"
        v-model:query="historyQuery"
        :tasks="filteredTasks"
        :display-names="localHistoryNames"
        :selected-task-id="activeView === 'result' ? (task?.id ?? null) : null"
        :loading="loadingLatest"
        :error="localHistoryError"
        :return-focus="historyTrigger"
        @select="selectTask"
    />

    <AppConfirmDialog
        v-model:open="abandonConfirmOpen"
        :title="t('workspace.abandonConfirmTitle')"
        :description="t('workspace.abandonConfirmDescription')"
        :confirm-label="t('workspace.abandonConfirmAction')"
        :cancel-label="t('common.cancel')"
        :busy="lifecycleBusy"
        tone="danger"
        @confirm="confirmAbandon"
    />

    <AppConfirmDialog
        v-model:open="historyDeleteConfirmOpen"
        :title="t('workspace.localHistory.deleteConfirmTitle')"
        :description="t('workspace.localHistory.deleteConfirm')"
        :confirm-label="t('workspace.localHistory.deleteConfirmAction')"
        :cancel-label="t('common.cancel')"
        :busy="deletingHistoryTaskId !== null"
        tone="danger"
        @confirm="confirmDeleteCurrentLocalHistory"
        @cancel="pendingHistoryDeleteTaskId = null"
    />
</template>

<style scoped>
@media (min-width: 1024px) and (min-height: 720px) {
    .analysis-workspace-main {
        /* 详情在面板内滚动，内部布局与绘制不扩张页面根滚动范围。 */
        contain: layout paint;
    }

    .analysis-workspace-shell {
        height: calc(100dvh - 4rem);
        overflow: hidden;
    }
}

@media (min-width: 1024px) and (max-height: 719px) {
    .analysis-workspace-shell {
        align-items: start;
    }

    .analysis-workspace-main {
        min-height: 24rem;
        flex: none;
    }
}
</style>
