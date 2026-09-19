import type { Cookie } from 'elysia'

import { TIME_MS } from '../config/constants'
import { env } from '../config/env'
import { authThrottleConstraints } from '../auth-throttle/auth-throttle.constants'
import type { AuthSession } from './auth.service'

export const accessTokenCookieName = 'teeho_access_token'
export const refreshTokenCookieName = 'teeho_refresh_token'
export const oauthCodeVerifierCookieName = 'teeho_oauth_code_verifier'
export const oauthRedirectCookieName = 'teeho_oauth_redirect'
export const loginDeviceCookieName = 'teeho_login_device'

type CookieJar = Record<string, Cookie<unknown>>

const commonCookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.NODE_ENV === 'production',
}
const minimumAccessTokenMaxAgeSeconds = 60
const refreshTokenLifetimeDays = 30
const oauthCookieLifetimeMinutes = 10
const refreshTokenMaxAgeSeconds = (refreshTokenLifetimeDays * TIME_MS.DAY) / TIME_MS.SECOND
const oauthCookieMaxAgeSeconds = (oauthCookieLifetimeMinutes * TIME_MS.MINUTE) / TIME_MS.SECOND

/** 从 Elysia Cookie 容器读取字符串值 */
export function readCookie(cookie: CookieJar, name: string) {
    const value = cookie[name].value
    return typeof value === 'string' ? value : ''
}

/** 写入 Supabase access/refresh token，二者均不暴露给浏览器脚本 */
export function setSessionCookies(cookie: CookieJar, session: AuthSession) {
    cookie[accessTokenCookieName].set({
        ...commonCookieOptions,
        value: session.accessToken,
        maxAge: Math.max(session.expiresIn, minimumAccessTokenMaxAgeSeconds),
        path: '/api',
    })
    cookie[refreshTokenCookieName].set({
        ...commonCookieOptions,
        value: session.refreshToken,
        maxAge: refreshTokenMaxAgeSeconds,
        path: '/api/auth',
    })
}

/** 保存服务端签发的匿名登录设备令牌，只允许登录接口接收。 */
export function setLoginDeviceCookie(cookie: CookieJar, token: string) {
    cookie[loginDeviceCookieName].set({
        ...commonCookieOptions,
        value: token,
        maxAge: authThrottleConstraints.deviceTokenLifetimeSeconds,
        path: '/api/auth/login',
    })
}

/** 暂存 Google OAuth PKCE 校验器与登录后站内跳转路径 */
export function setOAuthCookies(cookie: CookieJar, codeVerifier: string, redirectPath: string) {
    const options = {
        ...commonCookieOptions,
        maxAge: oauthCookieMaxAgeSeconds,
        path: '/api/auth/google/callback',
    }
    cookie[oauthCodeVerifierCookieName].set({ ...options, value: codeVerifier })
    cookie[oauthRedirectCookieName].set({ ...options, value: redirectPath })
}

/** 清理一次性的 Google OAuth Cookie */
export function clearOAuthCookies(cookie: CookieJar) {
    const options = {
        ...commonCookieOptions,
        value: '',
        expires: new Date(0),
        maxAge: 0,
        path: '/api/auth/google/callback',
    }
    cookie[oauthCodeVerifierCookieName].set(options)
    cookie[oauthRedirectCookieName].set(options)
}

/** 以原路径和安全属性过期认证 Cookie */
export function clearSessionCookies(cookie: CookieJar) {
    cookie[accessTokenCookieName].set({
        ...commonCookieOptions,
        value: '',
        expires: new Date(0),
        maxAge: 0,
        path: '/api',
    })
    cookie[refreshTokenCookieName].set({
        ...commonCookieOptions,
        value: '',
        expires: new Date(0),
        maxAge: 0,
        path: '/api/auth',
    })
}
