import { Elysia } from 'elysia'
import { describe, expect, it, vi } from 'vitest'
import { createSkillAuthRoutes } from '../skill-auth/skill-auth.routes'
import { createSkillDistributionRoutes } from './skill-distribution.routes'

function controller() {
    const operation = () =>
        vi.fn(async () => ({ status: 200, response: { code: 0, message: 'ok', data: {} } }))
    return {
        start: operation(),
        token: operation(),
        anonymous: operation(),
        devices: operation(),
        revoke: operation(),
        logout: operation(),
        approve: operation(),
    }
}

describe('Skill upgrade protocol before authorization', () => {
    it.each(['start', 'token', 'anonymous'] as const)(
        'rejects legacy %s without creating or refreshing identity',
        async (action) => {
            const actions = controller()
            const app = new Elysia({ prefix: '/api' }).use(createSkillAuthRoutes(actions))
            const response = await app.handle(
                new Request(`http://localhost/api/skill/auth/${action}`, { method: 'POST' }),
            )
            expect(response.status).toBe(400)
            expect(await response.json()).toMatchObject({
                code: 4260,
                data: { reason: 'skill_upgrade_required' },
            })
            expect(actions[action]).not.toHaveBeenCalled()
        },
    )

    it.each(['logout', 'revoke', 'approve'] as const)(
        'keeps %s accessible without a Skill version',
        async (action) => {
            const actions = controller()
            const app = createSkillAuthRoutes(actions)
            expect(
                (
                    await app.handle(
                        new Request(`http://localhost/skill/auth/${action}`, { method: 'POST' }),
                    )
                ).status,
            ).toBe(200)
            expect(actions[action]).toHaveBeenCalledOnce()
        },
    )

    it('always exposes version information and the same-site download', async () => {
        const app = createSkillDistributionRoutes({ download: async () => new Response('zip') })
        const headers = { 'x-teeho-skill-version': 'invalid' }
        const info = await app.handle(new Request('http://localhost/skill/version', { headers }))
        expect(info.status).toBe(200)
        expect(await info.json()).toEqual({
            code: 0,
            message: 'ok',
            data: {
                minimumVersion: '2.1.0',
                latestVersion: '2.1.0',
                downloadPath: '/skill/download',
            },
        })
        expect(info.headers.get('cache-control')).toBe('no-store')
        expect(
            await (
                await app.handle(new Request('http://localhost/skill/download', { headers }))
            ).text(),
        ).toBe('zip')
    })
})
