import { Elysia, status } from 'elysia'

import { accessTokenCookieName, readCookie } from '../auth/auth.cookies'
import { resolveAuthSessionKey } from '../auth/auth.session-key'
import { getCurrentUser } from '../auth/auth.service'
import { API_CODES, HTTP_STATUS } from '../config/constants'
import { fail } from '../utils/response'
import { authenticateSkillToken } from '../skill-auth/skill-auth.runtime'
import { requireCompatibleSkill } from '../skill-distribution/skill-version'

/** 校验 `Authorization: Bearer` 是否存在；不满足时返回 `fail` 结果供路由短路 */
export function requireAuth(authorization?: string) {
    if (!authorization?.startsWith('Bearer ')) {
        return fail(API_CODES.UNAUTHORIZED, '未登录或 token 无效')
    }
    return null
}

/** 验证 HttpOnly Cookie 中的 access token 并返回可信用户 */
export async function authenticateApiUser(accessToken: string) {
    if (!accessToken) {
        return {
            success: false as const,
            status: 401,
            response: fail(API_CODES.UNAUTHORIZED, '请先登录'),
        }
    }

    const result = await getCurrentUser(accessToken)
    if (!result.success) {
        return {
            success: false as const,
            status: 401,
            response: fail(result.code, result.message),
        }
    }

    return {
        success: true as const,
        user: result.data,
        authSessionKey: resolveAuthSessionKey(accessToken),
    }
}

/**
 * 为后续 API 路由统一验证 HttpOnly Cookie，并注入可信账号。
 * `scoped` 作用域保证插件只保护显式使用它的路由模块。
 */
export const authenticatedApiPlugin = new Elysia({ name: 'authenticated-api' })
    .resolve({ as: 'scoped' }, async ({ cookie, request }) => {
        const bearer = request.headers.get('authorization')?.replace(/^Bearer /, '')
        if (bearer?.startsWith('teeho_skill_')) {
            const identity = await authenticateSkillToken(bearer)
            if (!identity)
                return status(
                    HTTP_STATUS.UNAUTHORIZED,
                    fail(API_CODES.UNAUTHORIZED, '登录已失效，请重新登录'),
                )
            const upgrade = requireCompatibleSkill(request)
            if (upgrade) return status(HTTP_STATUS.BAD_REQUEST, upgrade)
            return { apiUser: identity.user, apiAuthSessionKey: identity.authSessionKey }
        }
        const authentication = await authenticateApiUser(readCookie(cookie, accessTokenCookieName))
        if (!authentication.success) {
            return status(authentication.status, authentication.response)
        }
        return {
            apiUser: authentication.user,
            apiAuthSessionKey: authentication.authSessionKey,
        }
    })
    .as('scoped')
