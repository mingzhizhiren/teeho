import { HTTP_STATUS } from '../config/constants'

export const MODEL_SERVICE_UNAVAILABLE = 'model_service_unavailable'
export const MODEL_SERVICE_MAINTENANCE_MESSAGE = '服务器正在维护'

/** 模型依赖连接中断，不触发整站维护门禁。 */
export class ModelServiceUnavailableError extends Error {
    constructor(cause?: unknown) {
        super(MODEL_SERVICE_MAINTENANCE_MESSAGE, { cause })
        this.name = 'ModelServiceUnavailableError'
    }
}

/** 仅把上游网关断连与服务不可用状态映射为维护。 */
export function isModelServiceUnavailableStatus(status: unknown): boolean {
    return (
        status === HTTP_STATUS.BAD_GATEWAY ||
        status === HTTP_STATUS.SERVICE_UNAVAILABLE ||
        status === HTTP_STATUS.GATEWAY_TIMEOUT
    )
}
