import { Elysia } from 'elysia'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { logger } from '../utils/logger'
import { errorMiddleware } from './error'
import { requestLogMiddleware } from './request-log'

vi.mock('../utils/logger', () => ({
    logger: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}))

describe('error middleware', () => {
    afterEach(() => {
        vi.clearAllMocks()
    })

    it('records and maps an exception thrown by a route registered after the middleware', async () => {
        const errorLog = vi.mocked(logger.error)
        const requestLog = vi.mocked(logger.info)
        const app = new Elysia()
            .use(requestLogMiddleware)
            .use(errorMiddleware)
            .get('/boom', () => {
                throw new Error('boom')
            })

        const response = await app.handle(new Request('http://localhost/boom'))
        const requestId = response.headers.get('x-request-id')

        expect(response.status).toBe(500)
        expect(requestId).not.toBeNull()
        await expect(response.json()).resolves.toEqual({
            code: 5000,
            message: '服务器内部错误',
            data: null,
        })
        expect(errorLog).toHaveBeenCalledOnce()
        expect(errorLog).toHaveBeenCalledWith(
            expect.objectContaining({
                event: 'http_request_failed',
                err: expect.any(Error),
                method: 'GET',
                path: '/boom',
                requestId,
            }),
            '请求处理异常',
        )
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(requestLog).toHaveBeenCalledWith(
            expect.objectContaining({
                event: 'http_request_completed',
                method: 'GET',
                path: '/boom',
                requestId,
                status: 500,
            }),
            'request completed',
        )
    })

    it('redacts database query parameters from unexpected-error logs', async () => {
        const debugLog = vi.mocked(logger.debug)
        const errorLog = vi.mocked(logger.error)
        const sensitiveValue = 'private-user-content'
        const databaseCause = Object.assign(new Error(`duplicate key: ${sensitiveValue}`), {
            code: '23505',
            schema_name: 'public',
            table_name: 'analysis_tasks',
            constraint_name: 'analysis_tasks_user_active_idx',
            routine: '_bt_check_unique',
            detail: `Key (user_id)=(${sensitiveValue}) already exists`,
        })
        const databaseError = Object.assign(new Error(`query failed: ${sensitiveValue}`), {
            params: [sensitiveValue],
            query: 'UPDATE private_table SET payload = $1',
            cause: databaseCause,
        })
        const app = new Elysia()
            .use(requestLogMiddleware)
            .use(errorMiddleware)
            .get('/database-boom', () => {
                throw databaseError
            })

        const response = await app.handle(new Request('http://localhost/database-boom'))

        expect(response.status).toBe(500)
        expect(debugLog).toHaveBeenCalledWith(
            expect.objectContaining({
                event: 'database_error_context',
                databaseCode: '23505',
                databaseConstraint: 'analysis_tasks_user_active_idx',
                databaseRoutine: '_bt_check_unique',
                databaseSchema: 'public',
                databaseTable: 'analysis_tasks',
                method: 'GET',
                path: '/database-boom',
            }),
            '数据库请求失败诊断',
        )
        expect(errorLog).toHaveBeenCalledOnce()
        expect(JSON.stringify(debugLog.mock.calls)).not.toContain(sensitiveValue)
        expect(JSON.stringify(errorLog.mock.calls[0]?.[0])).not.toContain(sensitiveValue)
        expect(JSON.stringify(errorLog.mock.calls[0]?.[0])).not.toContain('private_table')
    })
})
