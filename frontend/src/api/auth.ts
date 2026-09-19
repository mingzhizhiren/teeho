import { createAuthApi } from '@/api/auth.contract'
import { request } from '@/utils/request'

export type {
    AuthLogoutOptions,
    AuthPayload,
    AuthUser,
    ChangePasswordInput,
    RegisterPayload,
} from '@/api/auth.contract'

const authApi = createAuthApi(request)

export const login = authApi.login
export const register = authApi.register
export const getMe = authApi.getMe
export const logout = authApi.logout
export const changePassword = authApi.changePassword

/** GET `/api/auth/google`：生成后端 Google OAuth 跳转地址。 */
export function getGoogleOAuthUrl(next = '/workspace'): string {
    const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/u, '')
    return `${apiBaseUrl}/auth/google?next=${encodeURIComponent(next)}`
}
