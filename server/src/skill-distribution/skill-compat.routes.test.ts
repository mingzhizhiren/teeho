import { Elysia } from 'elysia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticateSkillToken } from '../skill-auth/skill-auth.runtime'
import { getCurrentUser } from '../auth/auth.service'
import { skillCompatibilityRoutes } from './skill-compat.routes'
import { authenticatedApiPlugin } from '../middleware/auth'
import { isCompatibleSkillVersion } from './skill-version'

vi.mock('../auth/auth.service', () => ({ getCurrentUser: vi.fn() }))
vi.mock('../skill-auth/skill-auth.runtime', () => ({ authenticateSkillToken: vi.fn() }))

const app = new Elysia({ prefix: '/api' }).use(skillCompatibilityRoutes)
const identity = {
    id: '00000000-0000-4000-8000-000000000001',
    email: null,
    canChangePassword: false,
}

describe('released Skill API compatibility', () => {
    it('compares numeric components and permits a mandatory patch floor', () => {
        expect(isCompatibleSkillVersion('2.1.10', '2.1.9')).toBe(true)
        expect(isCompatibleSkillVersion('2.1.9', '2.1.10')).toBe(false)
        expect(isCompatibleSkillVersion('2.2.0', '2.1.10')).toBe(true)
    })
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
                headers: {
                    authorization: 'Bearer teeho_skill_test',
                    'x-teeho-skill-version': '2.1.0',
                },
            }),
        )
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            code: 0,
            message: 'ok',
            data: { summary: { enabled: false } },
        })
    })

    it.each([undefined, '', '1.14.1', '2.0.99', 'not-a-version', '2.1.0-preview'])(
        'blocks obsolete or invalid Skill version %s before creating a task',
        async (version) => {
            vi.mocked(authenticateSkillToken).mockResolvedValue({
                user: identity,
                authSessionKey: 'skill:test',
            })
            const createTask = vi.fn(() => ({ created: true }))
            const protectedApp = new Elysia()
                .use(authenticatedApiPlugin)
                .post('/api/analysis/tasks', createTask)
            const response = await protectedApp.handle(
                new Request('http://localhost/api/analysis/tasks', {
                    method: 'POST',
                    headers: {
                        authorization: 'Bearer teeho_skill_test',
                        ...(version === undefined ? {} : { 'x-teeho-skill-version': version }),
                    },
                }),
            )
            expect(response.status).toBe(400)
            expect(await response.json()).toMatchObject({
                code: 4260,
                message: expect.stringContaining('升级'),
                data: {
                    reason: 'skill_upgrade_required',
                    minimumVersion: '2.1.0',
                    latestVersion: '2.1.1',
                    downloadPath: '/skill/download',
                },
            })
            expect(createTask).not.toHaveBeenCalled()
        },
    )

    it.each(['2.1.0', '2.1.10', '2.10.0', '3.0.0'])(
        'allows compatible numeric version %s',
        async (version) => {
            vi.mocked(authenticateSkillToken).mockResolvedValue({
                user: identity,
                authSessionKey: 'skill:test',
            })
            const response = await app.handle(
                new Request('http://localhost/api/points/summary', {
                    headers: {
                        authorization: 'Bearer teeho_skill_test',
                        'x-teeho-skill-version': version,
                    },
                }),
            )
            expect(response.status).toBe(200)
        },
    )

    it('keeps browser authentication independent from Skill version headers', async () => {
        vi.mocked(getCurrentUser).mockResolvedValue({ success: true, data: identity } as Awaited<
            ReturnType<typeof getCurrentUser>
        >)
        const response = await app.handle(
            new Request('http://localhost/api/points/summary', {
                headers: { cookie: 'teeho_access_token=test', 'x-teeho-skill-version': 'invalid' },
            }),
        )
        expect(response.status).toBe(200)
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
