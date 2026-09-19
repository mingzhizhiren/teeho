import { Elysia } from 'elysia'

import { env } from '../config/env'
import { authenticatedApiPlugin } from '../middleware/auth'
import { WorkspaceEventConnectionLimitError, type WorkspaceEventHub } from './workspace-event'
import { createWorkspaceEventToken, verifyWorkspaceEventToken } from './workspace-event-token'
import { createWorkspaceEventResponse } from './workspace-event.stream'

interface WorkspaceEventRouteOptions {
    hub: WorkspaceEventHub
    tokenSecret?: string
}

/** 创建 Bearer 流端点和经 Supabase Cookie 验证的短期凭据端点。 */
export function createWorkspaceEventRoutes(options: WorkspaceEventRouteOptions) {
    const secret = options.tokenSecret ?? env.TEEHO_PWD
    const streamRoutes = new Elysia().get('/events', ({ request }) => {
        const authorization = request.headers.get('authorization') ?? ''
        const token = authorization.startsWith('Bearer ')
            ? authorization.slice('Bearer '.length)
            : ''
        const verified = verifyWorkspaceEventToken(token, { secret })
        if (!verified) {
            return new Response(null, { status: 401 })
        }
        try {
            return createWorkspaceEventResponse(options.hub, verified.userId, request.signal)
        } catch (error) {
            if (error instanceof WorkspaceEventConnectionLimitError) {
                return new Response(null, { status: 429 })
            }
            throw error
        }
    })
    const tokenRoutes = new Elysia()
        .use(authenticatedApiPlugin)
        .post('/events/token', ({ apiUser }) => {
            const token = createWorkspaceEventToken(apiUser.id, { secret })
            const verified = verifyWorkspaceEventToken(token, { secret })!
            return {
                code: 0,
                message: 'ok',
                data: { token, expiresAt: verified.expiresAt },
            }
        })

    return new Elysia({ prefix: '/workspace' }).use(streamRoutes).use(tokenRoutes)
}
