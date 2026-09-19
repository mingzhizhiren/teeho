import { Elysia } from 'elysia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticateSkillToken } from '../skill-auth/skill-auth.runtime'
import { getCurrentUser } from '../auth/auth.service'
import { skillCompatibilityRoutes } from './skill-compat.routes'

vi.mock('../auth/auth.service', () => ({ getCurrentUser: vi.fn() }))
vi.mock('../skill-auth/skill-auth.runtime', () => ({ authenticateSkillToken: vi.fn() }))

const app = new Elysia({ prefix: '/api' }).use(skillCompatibilityRoutes)
const identity = {
    id: '00000000-0000-4000-8000-000000000001',
    email: null,
    canChangePassword: false,
}

describe('released Skill community compatibility', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(authenticateSkillToken).mockResolvedValue(null)
        vi.mocked(getCurrentUser).mockResolvedValue({
            success: false,
            code: 4010,
            message: 'invalid',
        })
    })

    it('accepts a validated Skill token and reports metering disabled', async () => {
        vi.mocked(authenticateSkillToken).mockResolvedValue({
            user: identity,
            authSessionKey: 'skill:test',
        })
        const response = await app.handle(
            new Request('http://localhost/api/points/summary', {
                headers: { authorization: 'Bearer teeho_skill_test' },
            }),
        )
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            code: 0,
            message: 'ok',
            data: { summary: { enabled: false } },
        })
    })

    it('rejects missing and invalid credentials instead of bypassing authentication', async () => {
        const headerSets: HeadersInit[] = [{}, { authorization: 'Bearer teeho_skill_invalid' }]
        for (const headers of headerSets) {
            expect(
                (await app.handle(new Request('http://localhost/api/points/summary', { headers })))
                    .status,
            ).toBe(401)
        }
    })

    it('does not expose a purchase or balance mutation route', async () => {
        const response = await app.handle(
            new Request('http://localhost/api/points/topup', { method: 'POST' }),
        )
        expect(response.status).toBe(404)
    })
})
