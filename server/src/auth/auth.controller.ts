import { API_CODES, HTTP_STATUS } from '../config/constants'
import { env } from '../config/env'
import { fail, ok } from '../utils/response'
import { logger } from '../utils/logger'
import type { LoginThrottleContext } from '../auth-throttle/auth-throttle.service'
import { requestAnalysisUserAssetCleanupBestEffort } from '../analysis/media/analysis.asset-lifecycle.service'
import { analysisConversationTurnRunService } from '../analysis/conversation/analysis.conversation-turn-run.service'
import {
    type PasswordChangeUseCase,
    type PasswordChangeUseCaseOutcome,
} from '../auth-password-change/auth-password-change.use-case'
import {
    authRedirectSchema,
    changePasswordSchema,
    loginSchema,
    logoutSchema,
    oauthCallbackSchema,
    registerSchema,
} from './auth.schema'
import {
    beginGoogleLogin,
    completeGoogleLogin,
    getCurrentUser,
    loginWithThrottle,
    logout,
    register,
    renewSession,
} from './auth.service'
import { resolveAuthSessionKey } from './auth.session-key'

function passwordChangeFailure(outcome: PasswordChangeUseCaseOutcome) {
    switch (outcome.kind) {
        case 'invalid_current_password':
            return {
                status: HTTP_STATUS.BAD_REQUEST,
                response: fail(API_CODES.BAD_REQUEST, '当前密码错误', {
                    reason: 'password_change_invalid_current_password',
                }),
                shouldClearSession: false,
            }
        case 'invalid_new_password':
            return {
                status: HTTP_STATUS.BAD_REQUEST,
                response: fail(API_CODES.BAD_REQUEST, '新密码不符合安全要求', {
                    reason: 'password_change_invalid_new_password',
                }),
                shouldClearSession: false,
            }
        case 'session_invalid':
            return {
                status: HTTP_STATUS.UNAUTHORIZED,
                response: fail(API_CODES.UNAUTHORIZED, '登录已失效，请重新登录', {
                    reason: 'password_change_session_invalid',
                }),
                shouldClearSession: true,
            }
        case 'account_forbidden':
            return {
                status: HTTP_STATUS.FORBIDDEN,
                response: fail(API_CODES.FORBIDDEN, '当前账号没有可修改的密码凭证', {
                    reason: 'password_change_account_forbidden',
                }),
                shouldClearSession: false,
            }
        case 'provider_rate_limited':
            return {
                status: HTTP_STATUS.TOO_MANY_REQUESTS,
                response: fail(API_CODES.RATE_LIMITED, '密码服务请求过于频繁，请稍后再试', {
                    reason: 'password_change_provider_rate_limited',
                }),
                shouldClearSession: false,
            }
        case 'rate_limited':
            return {
                status: HTTP_STATUS.TOO_MANY_REQUESTS,
                response: fail(API_CODES.RATE_LIMITED, '当前密码错误次数过多，请 15 分钟后再试', {
                    reason: 'password_change_rate_limited',
                }),
                shouldClearSession: false,
            }
        case 'in_progress':
            return {
                status: HTTP_STATUS.CONFLICT,
                response: fail(API_CODES.CONFLICT, '密码修改正在进行，请勿重复提交', {
                    reason: 'password_change_in_progress',
                }),
                shouldClearSession: false,
            }
        case 'result_unknown':
            return {
                status: HTTP_STATUS.SERVICE_UNAVAILABLE,
                response: fail(
                    API_CODES.INTERNAL_ERROR,
                    '密码修改结果未确认，请先尝试使用新密码登录',
                    { reason: 'password_change_result_unknown' },
                ),
                shouldClearSession: true,
            }
        case 'provider_unavailable':
        case 'changed':
            return {
                status: HTTP_STATUS.SERVICE_UNAVAILABLE,
                response: fail(API_CODES.INTERNAL_ERROR, '密码服务暂不可用，请稍后重试', {
                    reason: 'password_change_provider_unavailable',
                }),
                shouldClearSession: false,
            }
    }
}

/** 校验登录参数并调用认证服务 */
export async function handleLogin(body: unknown, context: LoginThrottleContext) {
    const parsed = loginSchema.safeParse(body)
    if (!parsed.success) {
        return {
            status: 400,
            response: fail(API_CODES.VALIDATION_ERROR, '请输入有效邮箱和 8 至 128 位密码'),
            session: null,
        }
    }

    const result = await loginWithThrottle(parsed.data, context)
    if (!result.success) {
        return {
            status:
                result.code === API_CODES.UNAUTHORIZED
                    ? HTTP_STATUS.UNAUTHORIZED
                    : result.code === API_CODES.RATE_LIMITED
                      ? HTTP_STATUS.TOO_MANY_REQUESTS
                      : HTTP_STATUS.SERVICE_UNAVAILABLE,
            response: fail(result.code, result.message),
            session: null,
        }
    }

    return {
        status: 200,
        response: ok({ user: result.data.user }),
        session: result.data,
    }
}

/** 校验注册参数并调用认证服务 */
export async function handleRegister(body: unknown) {
    const parsed = registerSchema.safeParse(body)
    if (!parsed.success) {
        return {
            status: 400,
            response: fail(API_CODES.VALIDATION_ERROR, '请输入有效邮箱和 8 至 128 位密码'),
            session: null,
        }
    }

    const result = await register(parsed.data)
    if (!result.success) {
        return {
            status:
                result.code === API_CODES.CONFLICT ? HTTP_STATUS.CONFLICT : HTTP_STATUS.BAD_REQUEST,
            response: fail(result.code, result.message),
            session: null,
        }
    }

    return {
        status: result.data.requiresEmailConfirmation ? HTTP_STATUS.ACCEPTED : HTTP_STATUS.CREATED,
        response: ok({
            user: result.data.user,
            requiresEmailConfirmation: result.data.requiresEmailConfirmation,
        }),
        session: result.data.session,
    }
}

/** 创建 Google OAuth 跳转信息 */
export async function handleGoogleLogin(query: unknown) {
    const parsedRedirect = authRedirectSchema.safeParse(
        typeof query === 'object' && query !== null && 'next' in query ? query.next : undefined,
    )
    const redirectPath = parsedRedirect.success ? parsedRedirect.data : '/workspace'
    const callbackUrl = new URL('/api/auth/google/callback', env.PUBLIC_API_URL).toString()
    const result = await beginGoogleLogin(callbackUrl)

    if (!result.success) {
        return { success: false as const, redirectPath: '/login?oauth_error=1' }
    }

    return { success: true as const, ...result.data, redirectPath }
}

/** 校验 Google OAuth 回调并交换站内会话 */
export async function handleGoogleCallback(query: unknown, codeVerifier: string) {
    const parsed = oauthCallbackSchema.safeParse(query)
    if (!parsed.success || parsed.data.error || !parsed.data.code || !codeVerifier) {
        return { success: false as const, session: null }
    }

    const result = await completeGoogleLogin(parsed.data.code, codeVerifier)
    if (!result.success) {
        return { success: false as const, session: null }
    }

    return { success: true as const, session: result.data }
}

/** 刷新认证会话 */
export async function handleRefresh(refreshToken: string) {
    if (!refreshToken) {
        return {
            status: 401,
            response: fail(API_CODES.UNAUTHORIZED, '登录已失效，请重新登录'),
            session: null,
        }
    }

    const result = await renewSession(refreshToken)
    if (!result.success) {
        return { status: 401, response: fail(result.code, result.message), session: null }
    }

    return {
        status: 200,
        response: ok({ user: result.data.user }),
        session: result.data,
    }
}

/** 获取当前登录用户 */
export async function handleGetMe(accessToken: string) {
    if (!accessToken) {
        return {
            status: 401,
            response: fail(API_CODES.UNAUTHORIZED, '请先登录'),
        }
    }

    const result = await getCurrentUser(accessToken)
    if (!result.success) {
        return { status: 401, response: fail(result.code, result.message) }
    }

    return { status: 200, response: ok({ user: result.data }) }
}

/** 校验当前会话与密码输入，修改成功前先使当前临时 Agent 回合失效。 */
export async function handleChangePassword(
    passwordChangeUseCase: PasswordChangeUseCase,
    accessToken: string,
    refreshToken: string,
    body: unknown,
    context: { clientIp: string | null } = { clientIp: null },
) {
    if (!accessToken || !refreshToken) {
        return {
            status: HTTP_STATUS.UNAUTHORIZED,
            response: fail(API_CODES.UNAUTHORIZED, '登录已失效，请重新登录'),
            shouldClearSession: true,
        }
    }
    const parsed = changePasswordSchema.safeParse(body)
    if (!parsed.success) {
        return {
            status: HTTP_STATUS.BAD_REQUEST,
            response: fail(
                API_CODES.VALIDATION_ERROR,
                parsed.error.issues[0]?.message ?? '密码输入无效',
            ),
            shouldClearSession: false,
        }
    }
    const outcome = await passwordChangeUseCase.execute({
        accessToken,
        refreshToken,
        clientIp: context.clientIp,
        password: parsed.data,
    })
    if (outcome.kind !== 'changed') return passwordChangeFailure(outcome)
    return {
        status: HTTP_STATUS.OK,
        response: ok(null, '密码已修改，请重新登录'),
        shouldClearSession: true,
    }
}

/** access 缺失或过期时用 refresh 会话解析同一账号，避免漏掉临时回合。 */
async function resolveLogoutIdentity(accessToken: string, refreshToken: string) {
    if (accessToken) {
        const currentUser = await getCurrentUser(accessToken)
        if (currentUser.success) {
            return {
                userId: currentUser.data.id,
                accessToken,
                refreshToken,
                authSessionKey: resolveAuthSessionKey(accessToken),
            }
        }
    }
    if (!refreshToken) return null
    const renewed = await renewSession(refreshToken)
    if (!renewed.success) return null
    return {
        userId: renewed.data.user.id,
        accessToken: renewed.data.accessToken,
        refreshToken: renewed.data.refreshToken,
        authSessionKey: resolveAuthSessionKey(renewed.data.accessToken),
    }
}

/** 响应注销前写入会话墓碑；Provider 撤销与素材删除仍不阻塞页面。 */
async function prepareLogoutAnalysisCleanupForSession(
    accessToken: string,
    refreshToken: string,
    cleanupCloudAssets: boolean,
) {
    try {
        const identity = await resolveLogoutIdentity(accessToken, refreshToken)
        if (!identity) {
            logger.debug(
                {
                    event: 'auth_logout_cleanup_identity_unavailable',
                    operation: 'logout',
                },
                '注销时未能解析账号清理身份',
            )
            throw new Error('logout_identity_unavailable')
        }
        await analysisConversationTurnRunService.invalidateUser(
            identity.userId,
            identity.authSessionKey,
        )
        if (cleanupCloudAssets) {
            requestAnalysisUserAssetCleanupBestEffort(identity.userId)
        }
        return {
            accessToken: identity.accessToken,
            refreshToken: identity.refreshToken,
        }
    } catch (error) {
        logger.warn(
            {
                event: 'auth_logout_cleanup_failed',
                errorName: error instanceof Error ? error.name : 'UnknownError',
                operation: 'logout',
            },
            '注销时建立临时回合失效门失败',
        )
        throw new Error('logout_guard_unavailable')
    }
}

/** 撤销当前会话，不等待认证提供方或云端素材清理。 */
export async function handleLogout(accessToken: string, refreshToken: string, body?: unknown) {
    const request = logoutSchema.parse(body)
    if (accessToken || refreshToken) {
        try {
            const revocation = await prepareLogoutAnalysisCleanupForSession(
                accessToken,
                refreshToken,
                request.cleanupCloudAssets,
            )
            if (revocation.refreshToken) {
                void logout(revocation.accessToken, revocation.refreshToken)
            }
        } catch {
            return {
                status: HTTP_STATUS.SERVICE_UNAVAILABLE,
                response: fail(API_CODES.INTERNAL_ERROR, '退出失败，请稍后重试'),
            }
        }
    }

    return { status: 200, response: ok(null, '已退出登录') }
}
