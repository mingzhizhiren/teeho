import { Elysia } from 'elysia'

import type { PasswordChangeUseCase } from '../auth-password-change/auth-password-change.use-case'
import { HTTP_STATUS } from '../config/constants'
import { env } from '../config/env'
import { readLoginClientIp } from '../auth-throttle/auth-throttle.client-ip'
import { resolveLoginDeviceToken } from '../auth-throttle/auth-throttle.token'
import {
    handleGetMe,
    handleChangePassword,
    handleGoogleCallback,
    handleGoogleLogin,
    handleLogin,
    handleLogout,
    handleRefresh,
    handleRegister,
} from './auth.controller'
import {
    accessTokenCookieName,
    clearOAuthCookies,
    clearSessionCookies,
    loginDeviceCookieName,
    oauthCodeVerifierCookieName,
    oauthRedirectCookieName,
    readCookie,
    refreshTokenCookieName,
    setSessionCookies,
    setOAuthCookies,
    setLoginDeviceCookie,
} from './auth.cookies'
import { authRedirectSchema } from './auth.schema'

/** 构造认证完成后跳转回前端应用的响应 */
function createAppRedirect(path: string) {
    const parsedPath = authRedirectSchema.safeParse(path)
    const safePath = parsedPath.success ? parsedPath.data : '/workspace'
    const appOrigin = env.CORS_ORIGIN || env.PUBLIC_API_URL
    return new URL(safePath, appOrigin).toString()
}

export interface AuthRouteHooks {
    authenticated?(
        cookie: Parameters<typeof readCookie>[0],
        session: Parameters<typeof setSessionCookies>[1],
        kind: 'registration' | 'current',
    ): void
    cleared?(cookie: Parameters<typeof readCookie>[0]): void
}

/** Supabase 认证 HTTP 路由：`/auth/*` */
export function createAuthRoutes(
    passwordChangeUseCase: PasswordChangeUseCase,
    hooks: AuthRouteHooks = {},
) {
    return new Elysia({ prefix: '/auth' })
        .post('/register', async ({ body, cookie, set }) => {
            const result = await handleRegister(body)
            set.status = result.status

            if (result.session) {
                setSessionCookies(cookie, result.session)
                hooks.authenticated?.(cookie, result.session, 'registration')
            }

            return result.response
        })
        .post('/login', async ({ body, cookie, request, server, set }) => {
            const device = resolveLoginDeviceToken(
                readCookie(cookie, loginDeviceCookieName),
                env.TEEHO_PWD,
            )
            if (device.created) {
                setLoginDeviceCookie(cookie, device.token)
            }
            const clientIp = readLoginClientIp(
                request.headers,
                server?.requestIP(request)?.address ?? '',
                env.NODE_ENV,
            )
            const result = await handleLogin(body, {
                clientIp,
                // 首次签发不落设备键，避免不保存 Cookie 的脚本制造随机设备记录。
                deviceToken: device.created ? null : device.token,
            })
            set.status = result.status

            if (result.session) {
                setSessionCookies(cookie, result.session)
                hooks.authenticated?.(cookie, result.session, 'current')
            }

            return result.response
        })
        .get('/google', async ({ query, cookie }) => {
            const result = await handleGoogleLogin(query)
            if (!result.success) {
                return Response.redirect(createAppRedirect(result.redirectPath), HTTP_STATUS.FOUND)
            }

            setOAuthCookies(cookie, result.codeVerifier, result.redirectPath)
            return Response.redirect(result.authorizationUrl, HTTP_STATUS.FOUND)
        })
        .get('/google/callback', async ({ query, cookie }) => {
            const redirectPath = readCookie(cookie, oauthRedirectCookieName)
            const result = await handleGoogleCallback(
                query,
                readCookie(cookie, oauthCodeVerifierCookieName),
            )
            clearOAuthCookies(cookie)

            if (!result.success) {
                return Response.redirect(
                    createAppRedirect('/login?oauth_error=1'),
                    HTTP_STATUS.FOUND,
                )
            }

            setSessionCookies(cookie, result.session)
            hooks.authenticated?.(cookie, result.session, 'registration')
            return Response.redirect(createAppRedirect(redirectPath), HTTP_STATUS.FOUND)
        })
        .post('/refresh', async ({ cookie, set }) => {
            const result = await handleRefresh(readCookie(cookie, refreshTokenCookieName))
            set.status = result.status

            if (result.session) {
                setSessionCookies(cookie, result.session)
            } else {
                clearSessionCookies(cookie)
            }

            return result.response
        })
        .post('/logout', async ({ body, cookie, set }) => {
            const result = await handleLogout(
                readCookie(cookie, accessTokenCookieName),
                readCookie(cookie, refreshTokenCookieName),
                body,
            )
            if (result.status === HTTP_STATUS.OK) {
                clearSessionCookies(cookie)
                hooks.cleared?.(cookie)
            }
            set.status = result.status
            return result.response
        })
        .post('/password', async ({ body, cookie, request, server, set }) => {
            const clientIp = readLoginClientIp(
                request.headers,
                server?.requestIP(request)?.address ?? '',
                env.NODE_ENV,
            )
            const result = await handleChangePassword(
                passwordChangeUseCase,
                readCookie(cookie, accessTokenCookieName),
                readCookie(cookie, refreshTokenCookieName),
                body,
                { clientIp },
            )
            if (result.shouldClearSession) {
                clearSessionCookies(cookie)
                hooks.cleared?.(cookie)
            }
            set.status = result.status
            return result.response
        })
        .get('/me', async ({ cookie, set }) => {
            const result = await handleGetMe(readCookie(cookie, accessTokenCookieName))
            set.status = result.status
            return result.response
        })
}
