import { describe, expect, test } from 'bun:test'
import { ref } from 'vue'
import type { AnalysisTask } from '@/features/analysis/analysis.contract'
import {
    useAnalysisTaskLifecycle,
    type AnalysisTaskLifecycleAdapter,
    type AnalysisTaskLifecycleOptions,
} from '@/features/analysis/useAnalysisTaskLifecycle'
import { createAnalysisTaskFixture } from './analysisTestFixtures'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void
    return {
        promise: new Promise<T>((resolvePromise) => {
            resolve = resolvePromise
        }),
        resolve: (value) => resolve(value),
    }
}

function waitingTask(): AnalysisTask {
    return createAnalysisTaskFixture({
        status: 'queued',
        preparationStatus: 'waiting',
        result: null,
        resultVersion: null,
        attemptCount: 0,
        startedAt: null,
        completedAt: null,
    })
}

function createLifecycle(
    overrides: Partial<AnalysisTaskLifecycleAdapter> = {},
    options: Partial<AnalysisTaskLifecycleOptions> = {},
) {
    return useAnalysisTaskLifecycle(
        {
            historyRecords: ref([]),
            submissionIntents: ref([]),
            persistHistory: async () => undefined,
            removeHistory: async () => undefined,
            setError: () => undefined,
            formatError: () => 'request failed',
            reanalysisIntents: {
                prepare: async (sourceTaskId) => ({
                    sourceTaskId,
                    submissionId: 'submission',
                    ownerUserId: 'owner',
                }),
                isCurrentOwner: () => true,
                confirm: async () => undefined,
            },
            ...options,
        },
        {
            listTasks: async () => [],
            getTask: async () => waitingTask(),
            abandonTask: async () => waitingTask(),
            retryTask: async () => waitingTask(),
            reanalyzeTask: async () => waitingTask(),
            ...overrides,
        },
    )
}

describe('preparation task recovery and account isolation', () => {
    test('仅本次查看的任务确认终态后释放恢复索引，避免下次重复认领旧任务', async () => {
        const pending = waitingTask()
        const forgotten: string[] = []
        const lifecycle = createLifecycle(
            {
                listTasks: async () => [
                    { ...pending, status: 'succeeded', preparationStatus: 'ready' },
                ],
            },
            {
                forgetSubmissionIntent: async (task) => {
                    forgotten.push(task.id)
                },
            },
        )
        lifecycle.registerSubmitted(pending, false)
        await lifecycle.refresh()
        expect(forgotten).toEqual([pending.id])
    })

    test('清理本地历史后仍发现服务端素材准备任务，并跟进准备完成的状态', async () => {
        let task = waitingTask()
        const lifecycle = createLifecycle({ listTasks: async () => [task] })
        await lifecycle.initialize()
        expect(lifecycle.currentTask.value?.preparationStatus).toBe('waiting')
        task = {
            ...task,
            preparationStatus: 'ready',
            status: 'processing',
            attemptCount: 1,
            updatedAt: '2026-10-13T10:00:00Z',
        }
        await lifecycle.refresh()
        expect(lifecycle.currentTask.value?.status).toBe('processing')
    })

    test('初始化期间退出，迟到列表不会在新账号写历史或设置当前任务', async () => {
        const response = deferred<AnalysisTask[]>()
        let ownerUserId: string | null = 'owner-a'
        let writes = 0
        const lifecycle = createLifecycle(
            { listTasks: () => response.promise },
            {
                ownerUserId: () => ownerUserId,
                persistHistory: async () => {
                    writes += 1
                },
            },
        )
        const pending = lifecycle.initialize()
        ownerUserId = 'owner-b'
        response.resolve([waitingTask()])
        await pending
        expect(lifecycle.currentTask.value).toBeNull()
        expect(lifecycle.tasks.value).toEqual([])
        expect(writes).toBe(0)
    })

    test('放弃请求途中切换账号，晚响应不能写入当前任务与历史', async () => {
        const response = deferred<AnalysisTask>()
        let ownerUserId = 'owner-a'
        let writes = 0
        const task = waitingTask()
        const lifecycle = createLifecycle(
            { abandonTask: () => response.promise },
            {
                ownerUserId: () => ownerUserId,
                persistHistory: async () => {
                    writes += 1
                },
            },
        )
        lifecycle.registerSubmitted(task, true)
        const pending = lifecycle.abandonCurrent()
        ownerUserId = 'owner-b'
        response.resolve({ ...task, status: 'abandoned' })
        await pending
        expect(lifecycle.currentTask.value?.status).toBe('queued')
        expect(writes).toBe(0)
    })

    test('卸载后同账号初始化响应也不会重新激活工作区', async () => {
        const response = deferred<AnalysisTask[]>()
        const lifecycle = createLifecycle({ listTasks: () => response.promise })
        const pending = lifecycle.initialize()
        lifecycle.deactivate()
        response.resolve([waitingTask()])
        await pending
        expect(lifecycle.currentTask.value).toBeNull()
    })
})
