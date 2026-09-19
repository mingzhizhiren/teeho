import { API_CODES, HTTP_STATUS } from '@/config/constants'

/** 从统一响应数据中读取稳定错误标识。 */
export function readApiErrorReason(data: unknown): string | undefined {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined
    const reason = Reflect.get(data, 'reason')
    return typeof reason === 'string' ? reason : undefined
}

/** 只识别维护门禁响应，恢复控制面自身失败不得触发页面跳转。 */
export function isServiceMaintenanceResponse(
    status: number | null,
    body: unknown,
): boolean {
    if (
        status !== HTTP_STATUS.SERVICE_UNAVAILABLE ||
        typeof body !== 'object' ||
        body === null
    ) {
        return false
    }
    return (
        Reflect.get(body, 'code') === API_CODES.SERVICE_MAINTENANCE &&
        readApiErrorReason(Reflect.get(body, 'data')) === 'service_maintenance'
    )
}
