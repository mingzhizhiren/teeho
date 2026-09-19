import { AsyncLocalStorage } from 'node:async_hooks'

export interface RequestObservabilityContext {
    requestId: string
    startTime: number
}

const requestContextStorage = new AsyncLocalStorage<RequestObservabilityContext>()

/** 绑定当前请求的观测上下文，供日志器和下游服务自动关联。 */
export function enterRequestObservabilityContext(context: RequestObservabilityContext) {
    requestContextStorage.enterWith(context)
}

/** 读取当前异步调用链中的请求观测上下文。 */
export function getRequestObservabilityContext() {
    return requestContextStorage.getStore()
}
