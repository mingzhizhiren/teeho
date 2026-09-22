import { Elysia } from 'elysia'
import { readCookie, accessTokenCookieName } from '../auth/auth.cookies'
import { readLoginClientIp } from '../auth-throttle/auth-throttle.client-ip'
import { env } from '../config/env'
import type { SkillAuthController } from './skill-auth.controller'
import { requireCompatibleSkill } from '../skill-distribution/skill-version'
import { HTTP_STATUS } from '../config/constants'

/** 设备授权的公开协议与浏览器确认入口。 */
export function createSkillAuthRoutes(controller: SkillAuthController) {
    return new Elysia({ prefix: '/skill/auth' })
        .onBeforeHandle(({ request, set }) => {
            if (!/\/skill\/auth\/(start|token|anonymous)\/?$/.test(new URL(request.url).pathname))
                return
            const upgrade = requireCompatibleSkill(request)
            if (upgrade) {
                set.status = HTTP_STATUS.BAD_REQUEST
                set.headers['cache-control'] = 'no-store'
                return upgrade
            }
        })
        .onAfterHandle(({ set }) => {
            set.headers['cache-control'] = 'no-store'
        })
        .get('/devices', async ({ cookie, set, query }) => {
            const result = await controller.devices(
                readCookie(cookie, accessTokenCookieName),
                query,
            )
            set.status = result.status
            return result.response
        })
        .post('/revoke', async ({ body, cookie, request, set }) => {
            const result = await controller.revoke(
                body,
                readCookie(cookie, accessTokenCookieName),
                request.headers.get('origin') ?? '',
            )
            set.status = result.status
            return result.response
        })
        .post('/logout', async ({ request, set }) => {
            const result = await controller.logout(
                request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '',
            )
            set.status = result.status
            return result.response
        })
        .post('/start', async ({ body, request, server, set }) => {
            const ip =
                readLoginClientIp(
                    request.headers,
                    server?.requestIP(request)?.address ?? '',
                    env.NODE_ENV,
                ) ?? 'unknown'
            const result = await controller.start(body, ip)
            set.status = result.status
            return result.response
        })
        .post('/token', async ({ body, request, server, set }) => {
            const ip =
                readLoginClientIp(
                    request.headers,
                    server?.requestIP(request)?.address ?? '',
                    env.NODE_ENV,
                ) ?? 'unknown'
            const result = await controller.token(body, ip)
            set.status = result.status
            return result.response
        })
        .post('/anonymous', async ({ body, request, server, set }) => {
            const ip =
                readLoginClientIp(
                    request.headers,
                    server?.requestIP(request)?.address ?? '',
                    env.NODE_ENV,
                ) ?? 'unknown'
            const result = await controller.anonymous(body, ip)
            set.status = result.status
            return result.response
        })
        .post('/approve', async ({ body, cookie, request, server, set }) => {
            const ip =
                readLoginClientIp(
                    request.headers,
                    server?.requestIP(request)?.address ?? '',
                    env.NODE_ENV,
                ) ?? 'unknown'
            const result = await controller.approve(
                body,
                readCookie(cookie, accessTokenCookieName),
                request.headers.get('origin') ?? '',
                ip,
            )
            set.status = result.status
            return result.response
        })
}
