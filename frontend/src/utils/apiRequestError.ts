/** API 请求错误携带的结构化恢复信息。 */
export interface ApiRequestErrorDetails {
    code: number | null
    status: number | null
    data: unknown
}

/** 保留统一错误响应中的安全恢复数据，同时兼容普通 Error 消费方。 */
export class ApiRequestError extends Error {
    readonly code: number | null
    readonly status: number | null
    readonly data: unknown

    constructor(message: string, details: ApiRequestErrorDetails) {
        super(message)
        this.name = 'ApiRequestError'
        this.code = details.code
        this.status = details.status
        this.data = details.data
    }
}

/** 只展示统一请求层已经净化的错误；其他异常使用调用方提供的本地化兜底。 */
export function getApiRequestErrorMessage(error: unknown, fallbackMessage: string): string {
    return error instanceof ApiRequestError ? error.message : fallbackMessage
}
