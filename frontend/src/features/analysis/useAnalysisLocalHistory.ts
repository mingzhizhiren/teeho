import { computed, ref, type ComputedRef } from 'vue'

import { useUserStorage } from '@/composables/useUserStorage'
import type { AnalysisTask } from './analysis.contract'
import {
    hasCompleteLocalHistoryImages,
    LocalHistoryError,
    LocalHistoryManager,
    type LocalHistoryRecord,
} from './localHistory'

/** 当前账号本地历史组合式函数所需的身份与错误文案。 */
export interface AnalysisLocalHistoryOptions {
    userId: ComputedRef<string | null>
    errorMessage: (operation: 'read' | 'write') => string
}

/** 管理当前账号的加密分析历史状态，并隐藏 IndexedDB 存储对象的创建与替换。 */
export function useAnalysisLocalHistory(options: AnalysisLocalHistoryOptions) {
    const userStorage = useUserStorage()
    const records = ref<LocalHistoryRecord[]>([])
    const error = ref('')
    const failedWriteTaskId = ref<string | null>(null)
    const manager = computed(() => {
        const userId = options.userId.value
        const storage = userStorage.files.value
        return userId && storage ? new LocalHistoryManager(userId, storage) : null
    })

    /** 按任务 ID 插入或更新响应式任务列表 */
    function upsert(record: LocalHistoryRecord) {
        records.value = [
            record,
            ...records.value.filter((candidate) => candidate.taskId !== record.taskId),
        ].sort((left, right) => Date.parse(right.task.createdAt) - Date.parse(left.task.createdAt))
    }

    /** 只有同一任务的素材也已保存，才解除之前的写入失败。 */
    function clearRecoveredWriteError(record: LocalHistoryRecord): void {
        if (failedWriteTaskId.value === record.taskId && hasCompleteLocalHistoryImages(record)) {
            error.value = ''
            failedWriteTaskId.value = null
        }
    }

    return {
        records,
        error,
        available: computed(() => manager.value !== null),

        /**
         * 从加密本地存储加载当前用户的分析历史并刷新响应式状态。
         */
        async load() {
            const currentManager = manager.value
            if (!currentManager) {
                records.value = []
                return records.value
            }
            try {
                records.value = await currentManager.listTasks()
                error.value = ''
            } catch {
                records.value = []
                error.value = options.errorMessage('read')
            }
            return records.value
        },

        /**
         * 保存任务及其原始图片，并更新当前页面的本地历史状态。
         * @param task 需要处理的分析任务
         * @param originalImages 用户本次提交的原始图片
         */
        async save(task: AnalysisTask, originalImages?: File[]) {
            const currentManager = manager.value
            if (!currentManager) {
                error.value = options.errorMessage('write')
                throw new LocalHistoryError('write_failed')
            }
            try {
                const record = await currentManager.saveTask(task, originalImages)
                upsert(record)
                clearRecoveredWriteError(record)
                return record
            } catch {
                failedWriteTaskId.value = task.id
                error.value = options.errorMessage('write')
                throw new LocalHistoryError('write_failed')
            }
        },

        /**
         * 从另一个本地任务复制原图，并保存目标任务。
         * @param task 需要保存的新任务
         * @param sourceTaskId 原图所属的来源任务 ID
         */
        async saveFromTask(task: AnalysisTask, sourceTaskId: string) {
            const currentManager = manager.value
            if (!currentManager) {
                error.value = options.errorMessage('write')
                throw new LocalHistoryError('write_failed')
            }
            try {
                const record = await currentManager.saveTaskFrom(task, sourceTaskId)
                upsert(record)
                clearRecoveredWriteError(record)
                return record
            } catch {
                failedWriteTaskId.value = task.id
                error.value = options.errorMessage('write')
                throw new LocalHistoryError('write_failed')
            }
        },

        /**
         * 读取指定历史任务关联的一张原图。
         * @param taskId 目标分析任务 ID
         * @param fileId 原图文件 ID
         */
        async getOriginalImage(taskId: string, fileId: string) {
            const currentManager = manager.value
            if (!currentManager) {
                throw new LocalHistoryError('read_failed')
            }
            return currentManager.getOriginalImage(taskId, fileId)
        },

        /**
         * 删除指定本地任务并同步更新页面状态。
         * @param taskId 目标分析任务 ID
         */
        async remove(taskId: string) {
            const currentManager = manager.value
            if (!currentManager) {
                error.value = options.errorMessage('write')
                throw new LocalHistoryError('clear_failed')
            }
            try {
                await currentManager.deleteTask(taskId)
                records.value = records.value.filter((record) => record.taskId !== taskId)
                error.value = ''
            } catch {
                error.value = options.errorMessage('write')
                throw new LocalHistoryError('clear_failed')
            }
        },

        /**
         * 判断指定任务是否已经保存到当前用户的本地历史。
         * @param taskId 目标分析任务 ID
         */
        isSaved(taskId: string) {
            return records.value.some((record) => record.taskId === taskId)
        },

        /**
         * 清除最近一次本地历史读写错误。
         */
        clearError() {
            error.value = ''
        },
    }
}
