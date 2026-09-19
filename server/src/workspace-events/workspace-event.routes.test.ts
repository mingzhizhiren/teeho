import { Elysia } from 'elysia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getCurrentUser } from '../auth/auth.service'
import { WorkspaceEventHub } from '@teeho/community-server/workspace-events/workspace-event'
import { createWorkspaceEventRoutes } from '@teeho/community-server/workspace-events/workspace-event.routes'
import { createWorkspaceEventToken } from '@teeho/community-server/workspace-events/workspace-event-token'

vi.mock('../config/env', () => ({ env: { TEEHO_PWD: 'unused-test-secret' } }))
vi.mock('../auth/auth.service', () => ({ getCurrentUser: vi.fn() }))

const userId = '00000000-0000-4000-8000-000000000001'
const secret = 'workspace-route-test-secret-with-sufficient-entropy'

describe('workspace event routes', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(getCurrentUser).mockResolvedValue({
            success: true,
            data: { id: userId, email: 'tester@example.com', canChangePassword: false },
        })
    })

    it('issues a stream credential only after Supabase session verification', async () => {
        const hub = new WorkspaceEventHub({ maximumConnections: 4, maximumPerUser: 2 })
        const app = new Elysia({ prefix: '/api' }).use(
            createWorkspaceEventRoutes({ hub, tokenSecret: secret }),
        )
        const response = await app.handle(
            new Request('http://localhost/api/workspace/events/token', {
                method: 'POST',
                headers: { cookie: 'teeho_access_token=verified-token' },
            }),
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({
            code: 0,
            data: { token: expect.any(String), expiresAt: expect.any(String) },
        })
        expect(getCurrentUser).toHaveBeenCalledWith('verified-token')
    })

    it('accepts a valid Authorization Bearer stream without exposing another account', async () => {
        const hub = new WorkspaceEventHub({ maximumConnections: 4, maximumPerUser: 2 })
        const app = new Elysia({ prefix: '/api' }).use(
            createWorkspaceEventRoutes({ hub, tokenSecret: secret }),
        )
        const token = createWorkspaceEventToken(userId, { secret })
        const abort = new AbortController()
        const response = await app.handle(
            new Request('http://localhost/api/workspace/events', {
                headers: { authorization: `Bearer ${token}` },
                signal: abort.signal,
            }),
        )

        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toContain('text/event-stream')
        expect(hub.connectionCount).toBe(1)
        abort.abort()
        await response.body?.cancel()
        expect(hub.connectionCount).toBe(0)
    })

    it('rejects a missing or invalid Bearer credential', async () => {
        const hub = new WorkspaceEventHub({ maximumConnections: 4, maximumPerUser: 2 })
        const app = new Elysia({ prefix: '/api' }).use(
            createWorkspaceEventRoutes({ hub, tokenSecret: secret }),
        )

        const response = await app.handle(new Request('http://localhost/api/workspace/events'))

        expect(response.status).toBe(401)
        expect(hub.connectionCount).toBe(0)
    })

    it('returns 429 before opening a stream when the account connection limit is reached', async () => {
        const hub = new WorkspaceEventHub({ maximumConnections: 1, maximumPerUser: 1 })
        const release = hub.subscribe(userId, vi.fn())
        const app = new Elysia({ prefix: '/api' }).use(
            createWorkspaceEventRoutes({ hub, tokenSecret: secret }),
        )
        const token = createWorkspaceEventToken(userId, { secret })

        const response = await app.handle(
            new Request('http://localhost/api/workspace/events', {
                headers: { authorization: `Bearer ${token}` },
            }),
        )

        expect(response.status).toBe(429)
        expect(hub.connectionCount).toBe(1)
        release()
    })
})
