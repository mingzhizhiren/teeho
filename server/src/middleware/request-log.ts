import { Elysia } from 'elysia'

import { HTTP_STATUS } from '../config/constants'
import {
    enterRequestObservabilityContext,
    getRequestObservabilityContext,
    type RequestObservabilityContext,
} from '../observability/request-context'
import { logger } from '../utils/logger'

const requestContexts = new WeakMap<Request, RequestObservabilityContext>()

/** 获取请求观测上下文；错误日志与访问日志共用同一请求标识 */
export function getRequestLogContext(request: Request) {
    return requestContexts.get(request) ?? getRequestObservabilityContext()
}

/** 从请求上下文中解析最终 HTTP 状态码 */
function resolveStatus(status: number | string | undefined) {
    return typeof status === 'number' ? status : HTTP_STATUS.OK
}

/** 请求结束后记录请求标识、方法、路径、状态码与耗时 */
export const requestLogMiddleware = new Elysia({ name: 'request-log' })
    .onRequest(({ request, set }) => {
        const requestId = crypto.randomUUID()
        requestContexts.set(request, {
            requestId,
            startTime: performance.now(),
        })
        enterRequestObservabilityContext(requestContexts.get(request)!)
        set.headers['x-request-id'] = requestId
    })
    .onAfterResponse(({ request, set }) => {
        const requestContext = requestContexts.get(request)
        requestContexts.delete(request)

        const status = resolveStatus(set.status)
        const durationMs = requestContext
            ? Math.round(performance.now() - requestContext.startTime)
            : undefined
        const fields = {
            event: 'http_request_completed',
            requestId: requestContext?.requestId,
            method: request.method,
            path: new URL(request.url).pathname,
            status,
            durationMs,
        }
        if (fields.path === '/api/health') {
            logger.debug(fields, 'request completed')
        } else {
            logger.info(fields, 'request completed')
        }
    })
    .as('global')
