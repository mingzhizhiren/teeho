import type { ApiResult } from '../types/common'

/** 统一 API 响应体类型（成功时 `code === 0`） */
export type { ApiResult } from '../types/common'

/** 构造成功响应 */
export function ok<T>(data: T, message = 'ok'): ApiResult<T> {
    return { code: 0, message, data }
}

/** 构造失败响应；无结构化恢复信息时 `data` 保持 null。 */
export function fail(code: number, message: string): ApiResult<null>
export function fail<T>(code: number, message: string, data: T): ApiResult<T>
export function fail<T>(code: number, message: string, data: T | null = null) {
    return { code, message, data }
}
