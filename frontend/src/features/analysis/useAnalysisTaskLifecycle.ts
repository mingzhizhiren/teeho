import { computed, ref, type Ref } from 'vue'

import { LatestRequestGate } from '@/utils/latestRequestGate'
import type { AnalysisTask } from './analysis.contract'
import { isActiveAnalysisTaskStatus } from './analysis.task-status'
import type { AnalysisSubmissionIntent } from './analysisSubmissionIntents'
import type { LocalHistoryRecord } from './localHistory'
import type {
    AnalysisReanalysisIntents,
    PreparedReanalysisIntent,
} from './useAnalysisReanalysisIntents'

/** 任务生命周期流程依赖的远程任务操作。 */
export interface AnalysisTaskLifecycleAdapter {
    listTasks: () => Promise<AnalysisTask[]>
    getTask: (taskId: string) => Promise<AnalysisTask>
    abandonTask: (taskId: string) => Promise<AnalysisTask>
    retryTask: (taskId: string) => Promise<AnalysisTask>
    reanalyzeTask: (taskId: string, submissionId: string) => Promise<AnalysisTask>
}

/** 任务生命周期组合式函数所需的历史、轮询与错误处理选项。 */
export interface AnalysisTaskLifecycleOptions {
    historyRecords: Ref<LocalHistoryRecord[]>
    submissionIntents: Readonly<Ref<readonly AnalysisSubmissionIntent[]>>
    reanalysisIntents: AnalysisReanalysisIntents
    persistHistory: (task: AnalysisTask, sourceTaskId?: string) => Promise<unknown>
    removeHistory: (task: AnalysisTask) => Promise<unknown>
    setError: (message: string) => void
    formatError: (error: unknown) => string
}

/** 管理远程分析任务同步、当前选择、轮询失效和生命周期写操作。 */
export function useAnalysisTaskLifecycle(
    options: AnalysisTaskLifecycleOptions,
    adapter: AnalysisTaskLifecycleAdapter,
) {
    const remoteTasks = ref<AnalysisTask[]>([])
    const currentTask = ref<AnalysisTask | null>(null)
    const actionBusy = ref(false)
    const sessionTaskIds = new Set<string>()
    const sessionOnlyTaskIds = new Set<string>()
    const historyRemovalTaskIds = new Set<string>()
    const refreshGate = new LatestRequestGate()

    /** 判断任务是否仍在后端执行链路中。 */
    function isActiveTask(task: AnalysisTask) {
        return isActiveAnalysisTaskStatus(task.status)
    }

    const tasks = computed(() => {
        const tasksById = new Map(
            options.historyRecords.value.map((record) => [record.task.id, record.task]),
        )
        remoteTasks.value.forEach((remoteTask) => tasksById.set(remoteTask.id, remoteTask))
        return Array.from(tasksById.values())
            .filter(
                (candidate) =>
                    candidate.status !== 'insufficient_points' && candidate.status !== 'abandoned',
            )
            .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    })

    /** 查找能够认领指定后端任务的本地提交意图。 */
    function findSubmissionIntent(task: AnalysisTask) {
        return options.submissionIntents.value.find(
            (intent) =>
                intent.submissionId === task.id ||
                (isActiveTask(task) && intent.inputFingerprint === task.inputFingerprint),
        )
    }

    /** 判断任务完成后是否需要保存到本地。 */
    function shouldPersist(task: AnalysisTask) {
        const submissionIntent = findSubmissionIntent(task)
        if (submissionIntent) {
            return submissionIntent.persistHistory
        }
        return (
            (sessionTaskIds.has(task.id) && !sessionOnlyTaskIds.has(task.id)) ||
            options.historyRecords.value.some((record) => record.taskId === task.id)
        )
    }

    /** 未成立或已放弃任务只保留当前状态提示，不进入本地历史。 */
    function removeExcludedHistory(task: AnalysisTask) {
        if (task.status !== 'insufficient_points' && task.status !== 'abandoned') {
            return false
        }
        sessionOnlyTaskIds.add(task.id)
        if (!historyRemovalTaskIds.has(task.id)) {
            historyRemovalTaskIds.add(task.id)
            void options.removeHistory(task).catch(() => undefined)
        }
        return true
    }

    /** 按任务 ID 插入或更新响应式任务列表 */
    function upsert(updatedTask: AnalysisTask, settings: { persist?: boolean } = {}) {
        remoteTasks.value = [
            updatedTask,
            ...remoteTasks.value.filter((candidate) => candidate.id !== updatedTask.id),
        ].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
        if (
            !removeExcludedHistory(updatedTask) &&
            settings.persist !== false &&
            shouldPersist(updatedTask)
        ) {
            void options.persistHistory(updatedTask).catch(() => undefined)
        }
        if (currentTask.value?.id === updatedTask.id) {
            currentTask.value = updatedTask
        }
    }

    /** 合并远端任务状态并维护当前选择 */
    async function synchronize(serverTasks: AnalysisTask[], isCurrent: () => boolean = () => true) {
        if (!isCurrent()) {
            return
        }
        const trackedTaskIds = new Set([
            ...options.historyRecords.value.map((record) => record.taskId),
            ...sessionTaskIds,
            // 从远端恢复的当前任务可能没有本地提交意图，仍须接收它的终态。
            ...(currentTask.value ? [currentTask.value.id] : []),
        ])
        const trackedFingerprints = new Set(
            options.submissionIntents.value.map((intent) => intent.inputFingerprint),
        )
        const trackedTasks = serverTasks.filter(
            (task) =>
                isActiveTask(task) ||
                trackedTaskIds.has(task.id) ||
                options.submissionIntents.value.some((intent) => intent.submissionId === task.id) ||
                (isActiveTask(task) && trackedFingerprints.has(task.inputFingerprint)),
        )
        remoteTasks.value = trackedTasks

        for (const trackedTask of trackedTasks) {
            if (!isCurrent()) {
                return
            }
            if (removeExcludedHistory(trackedTask) || !shouldPersist(trackedTask)) {
                continue
            }
            const savedRecord = options.historyRecords.value.find(
                (record) => record.taskId === trackedTask.id,
            )
            if (savedRecord?.task.updatedAt === trackedTask.updatedAt) {
                continue
            }
            try {
                await options.persistHistory(trackedTask)
            } catch {
                // 持久化模块已经记录安全的用户可见错误，轮询继续处理其他任务。
            }
        }
    }

    /** 初始化当前模块的远端和本地状态 */
    async function initialize() {
        const serverTasks = await adapter.listTasks()
        await synchronize(serverTasks)
        currentTask.value = tasks.value[0] ?? null
    }

    /** 刷新当前模块的数据状态 */
    async function refresh(silent = false) {
        await refreshGate.run(async (isCurrent) => {
            try {
                const serverTasks = await adapter.listTasks()
                if (!isCurrent()) {
                    return
                }
                await synchronize(serverTasks, isCurrent)
                if (!isCurrent()) {
                    return
                }
                if (currentTask.value) {
                    currentTask.value =
                        remoteTasks.value.find(
                            (candidate) => candidate.id === currentTask.value?.id,
                        ) ??
                        tasks.value.find((candidate) => candidate.id === currentTask.value?.id) ??
                        currentTask.value
                } else {
                    currentTask.value = tasks.value[0] ?? null
                }
            } catch (error) {
                if (!silent && isCurrent()) {
                    options.setError(options.formatError(error))
                }
            }
        })
    }

    /** 串行执行当前任务操作并处理错误 */
    async function runCurrentAction(action: (taskId: string) => Promise<AnalysisTask>) {
        const selectedTask = currentTask.value
        if (!selectedTask || actionBusy.value) {
            return
        }
        actionBusy.value = true
        options.setError('')
        refreshGate.invalidate()
        try {
            const updatedTask = await action(selectedTask.id)
            refreshGate.invalidate()
            upsert(updatedTask)
        } catch (error) {
            options.setError(options.formatError(error))
        } finally {
            refreshGate.invalidate()
            actionBusy.value = false
        }
    }

    /** 从当前结果创建全新分析任务并将工作台切换到新任务。 */
    async function reanalyzeCurrent() {
        const selectedTask = currentTask.value
        if (!selectedTask || actionBusy.value) {
            return
        }
        const persistReanalysis = shouldPersist(selectedTask)
        actionBusy.value = true
        options.setError('')
        refreshGate.invalidate()
        let intent: PreparedReanalysisIntent | null = null
        try {
            intent = await options.reanalysisIntents.prepare(selectedTask.id)
            if (!options.reanalysisIntents.isCurrentOwner(intent)) return
            const reanalysisTask = await adapter.reanalyzeTask(selectedTask.id, intent.submissionId)
            if (!options.reanalysisIntents.isCurrentOwner(intent)) return
            if (reanalysisTask.id !== intent.submissionId)
                throw new Error('analysis_reanalysis_identity_mismatch')
            sessionTaskIds.add(reanalysisTask.id)
            if (persistReanalysis) {
                sessionOnlyTaskIds.delete(reanalysisTask.id)
            } else {
                sessionOnlyTaskIds.add(reanalysisTask.id)
            }
            upsert(reanalysisTask, { persist: false })
            currentTask.value = reanalysisTask
            if (persistReanalysis) await options.persistHistory(reanalysisTask, selectedTask.id)
            await options.reanalysisIntents.confirm(intent)
        } catch (error) {
            if (intent && !options.reanalysisIntents.isCurrentOwner(intent)) return
            options.setError(options.formatError(error))
        } finally {
            refreshGate.invalidate()
            actionBusy.value = false
        }
    }

    return {
        tasks,
        currentTask,
        actionBusy,
        initialize,
        refresh,

        /**
         * 激活任务生命周期同步；后续刷新由工作台 SSE 事件触发。
         */
        activate() {
            return undefined
        },

        /**
         * 停用任务生命周期同步并使未完成请求失效。
         */
        deactivate() {
            refreshGate.invalidate()
        },

        /**
         * 使尚未完成的刷新请求失效，避免旧响应覆盖新状态。
         */
        invalidatePendingRefresh() {
            refreshGate.invalidate()
        },

        /**
         * 选择一个任务作为工作台当前任务，并同步最新成功结果。
         * @param selectedTask 用户选择的分析任务
         */
        select(selectedTask: AnalysisTask) {
            currentTask.value = selectedTask
        },

        /**
         * 登记刚提交的任务，并记录本次任务是否需要持久化到本地。
         * @param submittedTask 刚由服务端受理的分析任务
         * @param persistHistory 是否在任务完成后保存到本地历史
         */
        registerSubmitted(submittedTask: AnalysisTask, persistHistory: boolean) {
            sessionTaskIds.add(submittedTask.id)
            if (persistHistory) {
                sessionOnlyTaskIds.delete(submittedTask.id)
            } else {
                sessionOnlyTaskIds.add(submittedTask.id)
            }
            remoteTasks.value = [
                submittedTask,
                ...remoteTasks.value.filter((candidate) => candidate.id !== submittedTask.id),
            ]
            currentTask.value = submittedTask
        },

        /**
         * 把指定任务标记为仅在当前页面会话中保留。
         * @param taskId 目标分析任务 ID
         */
        markSessionOnly(taskId: string) {
            sessionOnlyTaskIds.add(taskId)
        },

        /**
         * 删除本地历史后继续在当前会话展示对应远端任务。
         * @param deletedTask 刚从本地历史删除的任务
         */
        retainAfterLocalDelete(deletedTask: AnalysisTask) {
            sessionTaskIds.add(deletedTask.id)
            sessionOnlyTaskIds.add(deletedTask.id)
            remoteTasks.value = [
                deletedTask,
                ...remoteTasks.value.filter((candidate) => candidate.id !== deletedTask.id),
            ]
        },

        /**
         * 打开已跟踪任务；必要时先从服务端加载最新状态。
         * @param taskId 目标分析任务 ID
         */
        async openTrackedTask(taskId: string) {
            let selectedTask = tasks.value.find((candidate) => candidate.id === taskId)
            if (!selectedTask?.result) {
                const isTrackedLocally = options.historyRecords.value.some(
                    (record) => record.taskId === taskId,
                )
                if (!isTrackedLocally && !sessionTaskIds.has(taskId)) {
                    return null
                }
                selectedTask = await adapter.getTask(taskId)
                upsert(selectedTask)
            }
            return selectedTask.result ? selectedTask : null
        },

        /**
         * 放弃当前选中的分析任务并刷新本地状态。
         */
        abandonCurrent() {
            return runCurrentAction(adapter.abandonTask)
        },

        /**
         * 重新排队当前失败任务并刷新本地状态。
         */
        retryCurrent() {
            return runCurrentAction(adapter.retryTask)
        },

        /**
         * 基于当前完整笔记创建新的体检任务，并保留原报告。
         */
        reanalyzeCurrent,
    }
}
