import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'

import { HTTP_STATUS } from '@/config/constants'
import { getFrontendRuntime } from '@/edition/runtime'
import { i18n } from '@/locales'
import { resolveApiErrorMessage } from '@/utils/apiErrorMessage'
import { ApiRequestError } from '@/utils/apiRequestError'
import { createBestEffortRequest } from '@/utils/bestEffortRequest'
import {
    isServiceMaintenanceResponse,
    readApiErrorReason,
} from '@/utils/maintenanceResponse'

export { isServiceMaintenanceResponse } from '@/utils/maintenanceResponse'

/** 后端统一响应外壳类型，成功时 `code === 0` */
export interface ApiResponse<T> {
    code: number
    message: string
    data: T
}

export { ApiRequestError } from '@/utils/apiRequestError'

const defaultRequestTimeoutMs = 10_000

const requestOptions = {
    baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
    timeout: defaultRequestTimeoutMs,
    withCredentials: true,
}

interface RetryRequestConfig extends InternalAxiosRequestConfig {
    authRetry?: boolean
    skipAuthRefresh?: boolean
}

const refreshRequest = axios.create(requestOptions)
let refreshPromise: Promise<boolean> | null = null
/** 按当前语言与稳定错误标识翻译服务端消息 */
function localizeServerMessage(message: string, data?: unknown): string {
    return resolveApiErrorMessage(
        message,
        i18n.global.locale.value,
        (key) => i18n.global.t(key),
        readApiErrorReason(data),
    )
}

/** 从接口错误响应中提取安全消息 */
function readApiError(error: AxiosError): ApiRequestError {
    const body = error.response?.data as Partial<ApiResponse<unknown>> | undefined
    const message =
        typeof body?.message === 'string' && body.message
            ? localizeServerMessage(body.message, body.data)
            : i18n.global.t('common.requestFailed')
    return new ApiRequestError(message, {
        code: typeof body?.code === 'number' ? body.code : null,
        status: error.response?.status ?? null,
        data: body?.data,
    })
}

/** 判断失败请求是否允许刷新会话后重试 */
function canRefreshSession(config: RetryRequestConfig) {
    const url = config.url ?? ''
    return (
        !config.authRetry &&
        config.skipAuthRefresh !== true &&
        !url.endsWith('/auth/login') &&
        !url.endsWith('/auth/register') &&
        !url.endsWith('/auth/refresh')
    )
}

/** 调用刷新接口轮换当前会话 */
async function refreshSession() {
    try {
        const response = await refreshRequest.post<ApiResponse<unknown>>('/auth/refresh')
        return response.data.code === 0
    } catch {
        return false
    }
}

/** 复用正在进行的会话刷新请求 */
async function ensureFreshSession() {
    if (!refreshPromise) {
        refreshPromise = refreshSession().finally(() => {
            refreshPromise = null
        })
    }

    return refreshPromise
}

/** Axios 实例：携带 HttpOnly 会话 Cookie，并在 access token 过期时轮换会话 */
export const request = axios.create(requestOptions)

export const sendBestEffortRequest = createBestEffortRequest(
    fetch,
    requestOptions.baseURL,
)

request.interceptors.response.use(
    (response) => {
        const body = response.data as ApiResponse<unknown>
        if (body.code !== 0) {
            return Promise.reject(
                new ApiRequestError(
                    body.message
                        ? localizeServerMessage(body.message, body.data)
                        : i18n.global.t('common.requestFailed'),
                    {
                        code: body.code,
                        status: response.status,
                        data: body.data,
                    },
                ),
            )
        }
        return response
    },
    async (error: AxiosError) => {
        if (isServiceMaintenanceResponse(error.response?.status ?? null, error.response?.data)) {
            getFrontendRuntime().onServiceUnavailable()
            return Promise.reject(readApiError(error))
        }
        const config = error.config as RetryRequestConfig | undefined
        if (
            error.response?.status === HTTP_STATUS.UNAUTHORIZED &&
            config &&
            canRefreshSession(config)
        ) {
            config.authRetry = true
            if (await ensureFreshSession()) {
                return request(config)
            }
        }

        return Promise.reject(readApiError(error))
    },
)
