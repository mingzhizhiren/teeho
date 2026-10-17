import { describe, expect, mock, test } from 'bun:test'
import { ref } from 'vue'
import { useAnalysisTaskLifecycle } from '../src/features/analysis/useAnalysisTaskLifecycle'
import type { AnalysisTask } from '../src/features/analysis/analysis.contract'
import { createAnalysisTaskFixture } from './analysisTestFixtures'

function setup(initialTasks: AnalysisTask[] = []) {
    const task = createAnalysisTaskFixture()
    const listTasks = mock(async () => initialTasks)
    const getTask = mock(async (taskId: string): Promise<AnalysisTask> => ({ ...task, id: taskId }))
    const persistHistory = mock(async () => undefined)
    const forgetSubmissionIntent = mock(async () => undefined)
    const owner = ref('owner-a')
    const lifecycle = useAnalysisTaskLifecycle(
        {
            ownerUserId: () => owner.value,
            historyRecords: ref([]),
            submissionIntents: ref([]),
            persistHistory,
            forgetSubmissionIntent,
            removeHistory: async () => undefined,
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
    return { lifecycle, listTasks, getTask, persistHistory, forgetSubmissionIntent, owner, task }
}

describe('同账号远端任务与本地历史独立', () => {
    test('初始化展示未在本浏览器提交的完成任务，不自动保存或清除提交意图', async () => {
        const completed = createAnalysisTaskFixture()
        const context = setup([completed])
        await context.lifecycle.initialize()
        expect(context.lifecycle.tasks.value).toEqual([completed])
        expect(context.persistHistory).not.toHaveBeenCalled()
        expect(context.forgetSubmissionIntent).not.toHaveBeenCalled()
    })

    test('事件刷新接收新的 Skill 完成任务，不抢走用户正在查看的报告', async () => {
        const first = createAnalysisTaskFixture()
        const newest = { ...first, id: 'remote-new', createdAt: '2026-10-16T15:37:00Z' }
        const context = setup([first])
        await context.lifecycle.initialize()
        context.lifecycle.select(first)
        context.listTasks.mockResolvedValue([newest, first])
        await context.lifecycle.refresh(true)
        expect(context.lifecycle.tasks.value.map((task) => task.id)).toContain(newest.id)
        expect(context.lifecycle.currentTask.value?.id).toBe(first.id)
        expect(context.persistHistory).not.toHaveBeenCalled()
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

    test('已放弃及积分不足仍不展示，删除本地历史后刷新不重新保存', async () => {
        const context = setup()
        context.lifecycle.registerSubmitted(context.task, true)
        context.lifecycle.retainAfterLocalDelete(context.task)
        context.listTasks.mockResolvedValue([
            context.task,
            { ...context.task, id: 'abandoned', status: 'abandoned' },
            { ...context.task, id: 'insufficient', status: 'insufficient_points' },
        ])
        await context.lifecycle.refresh()
        expect(context.lifecycle.tasks.value).toEqual([context.task])
        expect(context.persistHistory).not.toHaveBeenCalled()
    })
})
