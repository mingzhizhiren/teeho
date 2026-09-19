import { Elysia } from 'elysia'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getRequestObservabilityContext } from '../observability/request-context'
import { logger } from '../utils/logger'
import { requestLogMiddleware } from './request-log'

vi.mock('../utils/logger', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
    },
}))

describe('request log middleware', () => {
    afterEach(() => {
        vi.clearAllMocks()
    })

    it('把同一 requestId 绑定到响应、异步上下文和完成事件', async () => {
        const app = new Elysia().use(requestLogMiddleware).get('/context', async () => {
            await Promise.resolve()
            return { requestId: getRequestObservabilityContext()?.requestId }
        })

        const response = await app.handle(new Request('http://localhost/context'))
        const requestId = response.headers.get('x-request-id')

        await expect(response.json()).resolves.toEqual({ requestId })
        await vi.waitFor(() =>
            expect(logger.info).toHaveBeenCalledWith(
                expect.objectContaining({
                    event: 'http_request_completed',
                    requestId,
                    path: '/context',
                }),
                'request completed',
            ),
        )
    })

    it('健康检查只写 debug，避免生产 info 访问日志噪声', async () => {
        const app = new Elysia().use(requestLogMiddleware).get('/api/health', () => 'ok')

        await app.handle(new Request('http://localhost/api/health'))

        await vi.waitFor(() => expect(logger.debug).toHaveBeenCalledOnce())
        expect(logger.info).not.toHaveBeenCalled()
    })
})
