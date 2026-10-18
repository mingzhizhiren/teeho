import { describe, expect, mock, test } from 'bun:test'
import { ref } from 'vue'
import { useAnalysisTaskLifecycle } from '../src/features/analysis/useAnalysisTaskLifecycle'
import type { AnalysisTask } from '../src/features/analysis/analysis.contract'
import { createAnalysisTaskFixture } from './analysisTestFixtures'
import type { LocalHistoryRecord } from '../src/features/analysis/localHistory'

function setup(initialTasks: AnalysisTask[] = []) {
    const task = createAnalysisTaskFixture()
    const listTasks = mock(async () => initialTasks)
    const getTask = mock(async (taskId: string): Promise<AnalysisTask> => ({ ...task, id: taskId }))
    const persistHistory = mock(async () => undefined)
    const forgetSubmissionIntent = mock(async () => undefined)
    const owner = ref('owner-a')
    const historyRecords = ref<LocalHistoryRecord[]>([])
    const removeHistory = mock(async (task: AnalysisTask) => {
        historyRecords.value = historyRecords.value.filter((record) => record.taskId !== task.id)
    })
    const lifecycle = useAnalysisTaskLifecycle(
        {
            ownerUserId: () => owner.value,
            historyRecords,
            submissionIntents: ref([]),
            persistHistory,
            forgetSubmissionIntent,
            removeHistory,
            setError: () => undefined,
            formatError: () => 'request failed',
            reanalysisIntents: {
                prepare: async (sourceTaskId) => ({
                    sourceTaskId,
                    submissionId: 'new',
                    ownerUserId: owner.value,
                }),
                isCurrentOwner: () => true,
                confirm: async () => undefined,
            },
        },
        {
            listTasks,
            getTask,
            abandonTask: getTask,
            retryTask: getTask,
            reanalyzeTask: getTask,
        },
    )
    return {
        lifecycle,
        listTasks,
        getTask,
        persistHistory,
        forgetSubmissionIntent,
        owner,
        task,
        historyRecords,
        removeHistory,
    }
}

describe('同账号远端任务与本地历史独立', () => {
    test('初始化不把未保存的云端完成任务重新变成本地历史', async () => {
        const completed = createAnalysisTaskFixture()
        const context = setup([completed])
        await context.lifecycle.initialize()
        expect(context.lifecycle.tasks.value).toEqual([])
        expect(context.persistHistory).not.toHaveBeenCalled()
        expect(context.forgetSubmissionIntent).not.toHaveBeenCalled()
    })

    test('Skill 活动任务到完成在当前会话连续展示，刷新页面后不恢复未保存报告', async () => {
        const first = createAnalysisTaskFixture()
        const newest = { ...first, id: 'remote-new', createdAt: '2026-10-16T15:37:00Z' }
        const context = setup([first])
        context.lifecycle.registerSubmitted(first, false)
        await context.lifecycle.initialize()
        context.lifecycle.select(first)
        context.listTasks.mockResolvedValue([
            { ...newest, status: 'processing', result: null },
            first,
        ])
        await context.lifecycle.refresh(true)
        expect(context.lifecycle.tasks.value.find((task) => task.id === newest.id)?.status).toBe(
            'processing',
        )
        context.listTasks.mockResolvedValue([newest, first])
        await context.lifecycle.refresh(true)
        expect(context.lifecycle.tasks.value.map((task) => task.id)).toContain(newest.id)
        expect(context.lifecycle.currentTask.value?.id).toBe(first.id)
        expect(context.persistHistory).not.toHaveBeenCalled()
        const reloaded = setup([newest, first])
        await reloaded.lifecycle.initialize()
        expect(reloaded.lifecycle.tasks.value).toEqual([])
    })

    test('通知指向列表之外的任务时通过服务端所有权校验读取，不要求本地记录', async () => {
        const context = setup()
        const opened = await context.lifecycle.openTrackedTask(context.task.id)
        expect(context.getTask).toHaveBeenCalledWith(context.task.id)
        expect(opened).toEqual(context.task)
        expect(context.lifecycle.tasks.value).toEqual([context.task])
        expect(context.persistHistory).not.toHaveBeenCalled()
        expect(context.forgetSubmissionIntent).not.toHaveBeenCalled()
    })

    test('服务端拒绝访问的通知任务不会进入列表', async () => {
        const context = setup()
        context.getTask.mockRejectedValue(new Error('forbidden'))
        await expect(context.lifecycle.openTrackedTask('not-owned')).rejects.toThrow('forbidden')
        expect(context.lifecycle.tasks.value).toEqual([])
        expect(context.persistHistory).not.toHaveBeenCalled()
    })

    test('切换账号后忽略旧账号的通知详情响应', async () => {
        const context = setup()
        let resolve!: (task: AnalysisTask) => void
        context.getTask.mockImplementation(
            () =>
                new Promise((done) => {
                    resolve = done
                }),
        )
        const opening = context.lifecycle.openTrackedTask(context.task.id)
        context.owner.value = 'owner-b'
        resolve(context.task)
        expect(await opening).toBeNull()
        expect(context.lifecycle.tasks.value).toEqual([])
    })

    test('删除后清除列表与当前报告，刷新不能拉回或重新保存', async () => {
        const context = setup()
        context.lifecycle.registerSubmitted(context.task, true)
        await context.lifecycle.deleteLocalHistory(context.task)
        context.listTasks.mockResolvedValue([
            context.task,
            { ...context.task, id: 'abandoned', status: 'abandoned' },
            { ...context.task, id: 'insufficient', status: 'insufficient_points' },
        ])
        await context.lifecycle.refresh()
        expect(context.lifecycle.tasks.value).toEqual([])
        expect(context.lifecycle.currentTask.value).toBeNull()
        expect(context.removeHistory).toHaveBeenCalledTimes(1)
        expect(context.persistHistory).not.toHaveBeenCalled()
    })

    test.each(['queued', 'processing', 'retrying'] as const)(
        '清空后刷新仍能恢复同账号%s任务',
        async (status) => {
            const active = createAnalysisTaskFixture({ status, result: null })
            const context = setup([active, { ...active, id: 'old', status: 'succeeded' }])
            await context.lifecycle.initialize()
            expect(context.lifecycle.tasks.value).toEqual([active])
            expect(context.lifecycle.currentTask.value?.id).toBe(active.id)
            expect(context.persistHistory).not.toHaveBeenCalled()
        },
    )

    test('删除期间迟到的列表和通知响应不能恢复该报告', async () => {
        const context = setup()
        context.lifecycle.registerSubmitted({ ...context.task, result: null }, false)
        let resolveList!: (tasks: AnalysisTask[]) => void
        let resolveTask!: (task: AnalysisTask) => void
        context.listTasks.mockImplementation(
            () =>
                new Promise((done) => {
                    resolveList = done
                }),
        )
        context.getTask.mockImplementation(
            () =>
                new Promise((done) => {
                    resolveTask = done
                }),
        )
        const refreshing = context.lifecycle.refresh()
        const opening = context.lifecycle.openTrackedTask(context.task.id)
        await context.lifecycle.deleteLocalHistory(context.task)
        resolveList([context.task])
        resolveTask(context.task)
        await refreshing
        expect(await opening).toBeNull()
        expect(context.lifecycle.tasks.value).toEqual([])
        expect(context.lifecycle.currentTask.value).toBeNull()
    })

    test('删除失败保留报告和重试入口，不能假装成功', async () => {
        const context = setup()
        context.lifecycle.registerSubmitted(context.task, false)
        context.removeHistory.mockRejectedValueOnce(new Error('storage failure'))
        await expect(context.lifecycle.deleteLocalHistory(context.task)).rejects.toThrow()
        expect(context.lifecycle.tasks.value).toEqual([context.task])
        expect(context.lifecycle.currentTask.value?.id).toBe(context.task.id)
    })
})
