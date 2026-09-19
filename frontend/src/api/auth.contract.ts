import type { AxiosInstance } from 'axios'

import { AUTH_UI } from '@/config/constants'
import type { ApiResponse } from '@/utils/request'

export interface AuthUser {
    id: string
    email: string | null
    canChangePassword: boolean
}

export interface AuthPayload {
    user: AuthUser
}

export interface RegisterPayload {
    user: AuthUser | null
    requiresEmailConfirmation: boolean
}

export interface AuthLogoutOptions {
    readonly cleanupCloudAssets?: boolean
}

export interface ChangePasswordInput {
    currentPassword: string
    newPassword: string
    confirmPassword: string
}

/** 创建可注入传输层的 Auth HTTP Adapter，避免端点测试污染全局模块。 */
export function createAuthApi(client: Pick<AxiosInstance, 'get' | 'post'>) {
    const authRequestOptions = { timeout: AUTH_UI.REQUEST_TIMEOUT_MS }
    const passwordChangeRequestOptions = {
        ...authRequestOptions,
        skipAuthRefresh: true,
    }
    return {
        login(data: { email: string; password: string }) {
            return client.post<ApiResponse<AuthPayload>>(
                '/auth/login',
                data,
                authRequestOptions,
            )
        },
        register(data: { email: string; password: string }) {
            return client.post<ApiResponse<RegisterPayload>>(
                '/auth/register',
                data,
                authRequestOptions,
            )
        },
        getMe() {
            return client.get<ApiResponse<{ user: AuthUser }>>(
                '/auth/me',
                authRequestOptions,
            )
        },
        logout(options: AuthLogoutOptions = {}) {
            return client.post<ApiResponse<null>>('/auth/logout', options)
        },
        changePassword(data: ChangePasswordInput) {
            return client.post<ApiResponse<null>>(
                '/auth/password',
                data,
                passwordChangeRequestOptions,
            )
        },
    }
}
