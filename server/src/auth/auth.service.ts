import type { AuthError, User } from '@supabase/supabase-js'
import type { CredentialChangeFailureReason } from '../auth-password-change/auth-password-change.use-case'
import { loginThrottleMessage } from '../auth-throttle/auth-throttle.constants'
import {
    clearLoginIdentifierThrottle,
    isLoginAttemptBlocked,
    recordLoginFailure,
    type LoginThrottleContext,
} from '../auth-throttle/auth-throttle.service'
import { API_CODES, HTTP_STATUS } from '../config/constants'
import { logger } from '../utils/logger'
import type { ChangePasswordParam, LoginParam, RegisterParam } from './auth.schema'
import {
    createGoogleAuthorization,
    exchangeGoogleAuthorizationCode,
    getUser,
    refreshSession,
    signInWithPassword,
    signOut,
    signUpWithPassword,
    updatePassword,
} from './auth.repository'

/** 前端可见的登录用户信息 */
export interface AuthUser {
    isAnonymous?: boolean
    id: string
    email: string | null
    canChangePassword: boolean
}

/** Elysia 与 Supabase 之间使用的完整会话 */
export interface AuthSession {
    accessToken: string
    refreshToken: string
    expiresIn: number
    user: AuthUser
}

/** 注册结果；启用邮箱确认时 Supabase 不会立即创建会话 */
export interface AuthRegistration {
    user: AuthUser | null
    session: AuthSession | null
    requiresEmailConfirmation: boolean
}

export type AuthServiceResult<T> =
    | { success: true; data: T }
    | { success: false; code: number; message: string }

export type PasswordChangeServiceResult =
    | { success: true; data: { userId: string } }
    | {
          success: false
          code: number
          message: string
          reason: CredentialChangeFailureReason
      }

/** 把 Supabase 用户映射为应用用户信息 */
function mapUser(user: User): AuthUser {
    return {
        id: user.id,
        email: user.email ?? null,
        ...(user.app_metadata.teeho_skill_anonymous ? { isAnonymous: true } : {}),
        canChangePassword:
            !user.app_metadata.teeho_skill_anonymous &&
            (user.identities?.some((identity) => identity.provider === 'email') ?? false),
    }
}

/** 更新当前密码凭证并撤销全部刷新会话。 */
export async function changePassword(
    accessToken: string,
    _refreshToken: string,
    param: ChangePasswordParam,
): Promise<PasswordChangeServiceResult> {
    const current = await getUser(accessToken)
    if (current.error || !current.data.user) {
        return {
            success: false,
            code: API_CODES.UNAUTHORIZED,
            message: '登录已失效，请重新登录',
            reason: 'session_invalid',
        }
    }
    const user = mapUser(current.data.user)
    if (!user.canChangePassword) {
        return {
            success: false,
            code: API_CODES.FORBIDDEN,
            message: '当前账号没有可修改的密码凭证',
            reason: 'account_forbidden',
        }
    }
    if (!user.email) {
        return {
            success: false,
            code: API_CODES.FORBIDDEN,
            message: '当前账号没有可修改的密码凭证',
            reason: 'account_forbidden',
        }
    }
    try {
        const update = await updatePassword({
            userId: user.id,
            email: user.email,
            currentPassword: param.currentPassword,
            newPassword: param.newPassword,
        })
        if (!update.error && update.stage === 'complete' && !update.transportFailed) {
            return { success: true, data: { userId: user.id } }
        }
        if (update.resultUnknown) {
            return {
                success: false,
                code: API_CODES.INTERNAL_ERROR,
                message: '密码修改结果未确认，请先尝试使用新密码登录',
                reason: 'result_unknown',
            }
        }
        const error = update.error
        if (!error) {
            return {
                success: false,
                code: API_CODES.INTERNAL_ERROR,
                message: '密码服务暂不可用，请稍后重试',
                reason: 'provider_unavailable',
            }
        }
        if (['current_password_invalid', 'invalid_credentials'].includes(error.code ?? '')) {
            return {
                success: false,
                code: API_CODES.BAD_REQUEST,
                message: '当前密码错误',
                reason: 'invalid_current_password',
            }
        }
        const status = error.status ?? 0
        if (status === HTTP_STATUS.TOO_MANY_REQUESTS) {
            return {
                success: false,
                code: API_CODES.RATE_LIMITED,
                message: '密码服务请求过于频繁，请稍后再试',
                reason: 'provider_rate_limited',
            }
        }
        if (status === HTTP_STATUS.UNAUTHORIZED || update.identityMismatch) {
            return {
                success: false,
                code: API_CODES.UNAUTHORIZED,
                message: '登录已失效，请重新登录',
                reason: 'session_invalid',
            }
        }
        if (status > 0 && status < HTTP_STATUS.INTERNAL_SERVER_ERROR) {
            return {
                success: false,
                code: API_CODES.BAD_REQUEST,
                message: '新密码不符合安全要求',
                reason: 'invalid_new_password',
            }
        }
        logger.warn(
            {
                event: 'auth_provider_password_change_failed',
                provider: 'supabase',
                operation: 'password_change',
                authCode: error.code,
                status: error.status,
            },
            'Supabase 修改密码服务不可用',
        )
    } catch (error) {
        logger.warn(
            {
                event: 'auth_provider_password_change_failed',
                provider: 'supabase',
                operation: 'password_change',
                errorName: error instanceof Error ? error.name : 'UnknownError',
            },
            'Supabase 修改密码请求异常',
        )
        return {
            success: false,
            code: API_CODES.INTERNAL_ERROR,
            message: '密码修改结果未确认，请先尝试使用新密码登录',
            reason: 'result_unknown',
        }
    }
    return {
        success: false,
        code: API_CODES.INTERNAL_ERROR,
        message: '密码服务暂不可用，请稍后重试',
        reason: 'provider_unavailable',
    }
}

/** 把 Supabase 会话映射为应用登录会话 */
function mapSession(session: {
    access_token: string
    refresh_token: string
    expires_in: number
    user: User
}): AuthSession {
    return {
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        expiresIn: session.expires_in,
        user: mapUser(session.user),
    }
}

/** 创建凭证无效的稳定登录结果 */
function invalidCredentials(): AuthServiceResult<AuthSession> {
    return {
        success: false,
        code: API_CODES.UNAUTHORIZED,
        message: '邮箱或密码错误',
    }
}

/** 创建认证服务不可用的稳定登录结果 */
function unavailableLogin(error?: AuthError): AuthServiceResult<AuthSession> {
    if (error) {
        logger.warn(
            {
                event: 'auth_provider_unavailable',
                provider: 'supabase',
                operation: 'password_login',
                authCode: error.code,
                status: error.status,
            },
            'Supabase 登录服务不可用',
        )
    } else {
        logger.warn(
            {
                event: 'auth_provider_invalid_response',
                provider: 'supabase',
                operation: 'password_login',
            },
            'Supabase 登录服务未返回有效会话',
        )
    }

    return {
        success: false,
        code: API_CODES.INTERNAL_ERROR,
        message: '登录服务暂不可用，请稍后重试',
    }
}

/** 登录 Supabase Auth 并转换为站内会话 */
export async function login(param: LoginParam): Promise<AuthServiceResult<AuthSession>> {
    try {
        const { data, error } = await signInWithPassword(param)

        if (error) {
            const status = error.status ?? 0
            return status === 0 ||
                status === HTTP_STATUS.TOO_MANY_REQUESTS ||
                status >= HTTP_STATUS.INTERNAL_SERVER_ERROR
                ? unavailableLogin(error)
                : invalidCredentials()
        }
        if (!data.session || data.session.user.email?.trim().toLowerCase() !== param.email) {
            return unavailableLogin()
        }

        return { success: true, data: mapSession(data.session) }
    } catch (error) {
        logger.warn(
            {
                event: 'auth_provider_request_failed',
                err: error,
                provider: 'supabase',
                operation: 'password_login',
            },
            'Supabase 登录请求异常',
        )
        return {
            success: false,
            code: API_CODES.INTERNAL_ERROR,
            message: '登录服务暂不可用，请稍后重试',
        }
    }
}

/** 在 Supabase Auth 外围执行可插拔的多维登录限流。 */
export async function loginWithThrottle(
    param: LoginParam,
    context: LoginThrottleContext,
): Promise<AuthServiceResult<AuthSession>> {
    if (await isLoginAttemptBlocked(param.email, context)) {
        return {
            success: false,
            code: API_CODES.RATE_LIMITED,
            message: loginThrottleMessage,
        }
    }

    const result = await login(param)
    if (result.success) {
        await clearLoginIdentifierThrottle(param.email)
        return result
    }
    if (result.code !== API_CODES.UNAUTHORIZED) return result

    const limited = await recordLoginFailure(param.email, context)
    return limited
        ? {
              success: false,
              code: API_CODES.RATE_LIMITED,
              message: loginThrottleMessage,
          }
        : result
}

/** 创建 Supabase Auth 用户，并在允许时转换为站内会话 */
export async function register(param: RegisterParam): Promise<AuthServiceResult<AuthRegistration>> {
    const { data, error } = await signUpWithPassword(param)

    if (error?.code === 'user_already_exists') {
        return {
            success: true,
            data: {
                user: null,
                session: null,
                requiresEmailConfirmation: true,
            },
        }
    }

    if (error || !data.user) {
        logger.warn(
            {
                event: 'auth_provider_registration_failed',
                provider: 'supabase',
                operation: 'registration',
                authCode: error?.code,
                status: error?.status,
            },
            'Supabase 注册请求失败',
        )
        return {
            success: false,
            code: API_CODES.BAD_REQUEST,
            message: '注册失败，请稍后重试',
        }
    }

    const session = data.session ? mapSession(data.session) : null
    return {
        success: true,
        data: {
            user: session ? mapUser(data.user) : null,
            session,
            requiresEmailConfirmation: session === null,
        },
    }
}

/** 创建 Google OAuth PKCE 授权请求 */
export async function beginGoogleLogin(callbackUrl: string) {
    const { data, error, codeVerifier } = await createGoogleAuthorization(callbackUrl)
    if (error || !data.url || !codeVerifier) {
        logger.warn(
            {
                event: 'auth_provider_oauth_start_failed',
                provider: 'supabase',
                operation: 'google_oauth_start',
                authCode: error?.code,
                status: error?.status,
            },
            'Google 登录授权请求创建失败',
        )
        return {
            success: false as const,
            code: API_CODES.BAD_REQUEST,
            message: '暂时无法连接 Google 登录',
        }
    }

    return {
        success: true as const,
        data: { authorizationUrl: data.url, codeVerifier },
    }
}

/** 完成 Google OAuth 授权码交换 */
export async function completeGoogleLogin(
    code: string,
    codeVerifier: string,
): Promise<AuthServiceResult<AuthSession>> {
    const { data, error } = await exchangeGoogleAuthorizationCode(code, codeVerifier)
    if (error || !data.session) {
        logger.warn(
            {
                event: 'auth_provider_oauth_exchange_failed',
                provider: 'supabase',
                operation: 'google_oauth_exchange',
                authCode: error?.code,
                status: error?.status,
            },
            'Google 登录授权码交换失败',
        )
        return {
            success: false,
            code: API_CODES.UNAUTHORIZED,
            message: 'Google 登录失败，请重试',
        }
    }

    return { success: true, data: mapSession(data.session) }
}

/** 使用 refresh token 获取轮换后的 Supabase 会话 */
export async function renewSession(refreshToken: string): Promise<AuthServiceResult<AuthSession>> {
    const { data, error } = await refreshSession(refreshToken)

    if (error || !data.session) {
        return {
            success: false,
            code: API_CODES.UNAUTHORIZED,
            message: '登录已失效，请重新登录',
        }
    }

    return { success: true, data: mapSession(data.session) }
}

/** 验证 access token 并获取当前用户 */
export async function getCurrentUser(accessToken: string): Promise<AuthServiceResult<AuthUser>> {
    const { data, error } = await getUser(accessToken)

    if (error || !data.user) {
        return {
            success: false,
            code: API_CODES.UNAUTHORIZED,
            message: '登录已失效，请重新登录',
        }
    }

    return { success: true, data: mapUser(data.user) }
}

/** 尽力撤销当前会话，Cookie 始终由控制层同步清理 */
export async function logout(accessToken: string, refreshToken: string) {
    try {
        const { error } = await signOut(accessToken, refreshToken)
        if (error) {
            logger.warn(
                {
                    event: 'auth_provider_logout_failed',
                    provider: 'supabase',
                    operation: 'logout',
                    authCode: error.code,
                    status: error.status,
                },
                'Supabase 当前会话撤销失败',
            )
        }
    } catch (error) {
        logger.warn(
            {
                event: 'auth_provider_logout_failed',
                err: error,
                provider: 'supabase',
                operation: 'logout',
            },
            'Supabase 当前会话撤销异常',
        )
    }
}
