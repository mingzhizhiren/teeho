import { Elysia } from 'elysia'
import pino from 'pino'
import { afterEach, expect, it, vi } from 'vitest'
import { logger } from '../../utils/logger'
import {
    configureAnalysisHttpEvents,
    recordReportReturned,
    recordTaskAccepted,
} from './analysis.http-events'

afterEach(() => {
    configureAnalysisHttpEvents({})
    vi.restoreAllMocks()
})

it.each([
    {
        error: new Error('private-query', { cause: { code: '23514', detail: 'private-detail' } }),
        category: 'database_constraint',
    },
    {
        error: new Error('private-query', {
            cause: new Error('private-wrapper', {
                cause: { code: 'ECONNRESET', host: 'private-host' },
            }),
        }),
        category: 'connection',
    },
    {
        error: { code: 'private-code', name: 'private-name', message: 'private-message' },
        category: 'unknown',
    },
])('观测失败输出任务定位与安全分类 $category，保持HTTP成功', async ({ error, category }) => {
    const lines: string[] = []
    const output = pino(
        { base: null, timestamp: false },
        {
            write: (line) => {
                lines.push(line)
            },
        },
    )
    vi.spyOn(logger, 'warn').mockImplementation(output.warn.bind(output))
    const task = {
        id: '00000000-0000-4000-8000-000000000001',
        resultVersion: 2,
        result: { report: true },
    }
    configureAnalysisHttpEvents({
        taskAccepted: async () => {
            throw error
        },
        reportReturned: async () => {
            throw error
        },
    })
    const app = new Elysia().get('/report', async () => {
        await recordTaskAccepted('user', task.id, 'skill')
        await recordReportReturned('user', task, 'skill')
        return { task }
    })
    const response = await app.handle(new Request('http://localhost/report'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ task })
    expect(lines.map((line) => JSON.parse(line))).toEqual([
        expect.objectContaining({
            event: 'analysis_admission_observation_failed',
            taskId: task.id,
            source: 'skill',
            errorCategory: category,
        }),
        expect.objectContaining({
            event: 'analysis_report_observation_failed',
            taskId: task.id,
            resultVersion: 2,
            source: 'skill',
            errorCategory: category,
        }),
    ])
    expect(lines.join('')).not.toContain('private-')
})
