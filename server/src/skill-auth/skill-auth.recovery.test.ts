import { describe, expect, it } from 'vitest'
import { createSkillAuthController } from '@teeho/community-server/skill-auth/skill-auth.controller'
import { createSkillAuthRoutes } from '@teeho/community-server/skill-auth/skill-auth.routes'
import { MemorySkillStore } from '@teeho/community-server/skill-auth/skill-auth.test-store'

describe('Skill 授权结果恢复 HTTP', () => {
    it('同账号可恢复已批准授权，不因重复批准或保持登录选项延长临时期限', async () => {
        let now = Date.parse('2026-09-08T00:00:00Z')
        const user = { id: crypto.randomUUID(), email: null, canChangePassword: true }
        const other = { ...user, id: crypto.randomUUID() }
        const app = createSkillAuthRoutes(
            createSkillAuthController({
                store: new MemorySkillStore(),
                now: () => now,
                origin: 'http://localhost',
                resolveBrowser: async (token) => (token === 'owner' ? user : other),
                findUser: async () => user,
            }),
        )
        const post = (path: string, body: unknown, owner = 'owner') =>
            app.handle(
                new Request('http://localhost/skill/auth/' + path, {
                    method: 'POST',
                    headers: {
                        'x-teeho-skill-version': '2.1.0',
                        'content-type': 'application/json',
                        origin: 'http://localhost',
                        cookie: 'teeho_access_token=' + owner,
                    },
                    body: JSON.stringify(body),
                }),
            )
        const deviceToken = 'c'.repeat(64)
        const challenge = (
            await (await post('start', { deviceToken, deviceName: 'my device' })).json()
        ).data
        const first = (
            await (await post('approve', { userCode: challenge.userCode, remember: false })).json()
        ).data
        now += 600_001
        const retried = await post('approve', { userCode: challenge.userCode, remember: true })
        expect(retried.status).toBe(200)
        expect((await retried.json()).data).toEqual(first)
        expect(first.expiresAt).toBe('2026-09-09T00:00:00.000Z')
        expect(
            (await post('approve', { userCode: challenge.userCode, remember: true }, 'other'))
                .status,
        ).toBe(400)
        now = Date.parse(first.expiresAt)
        expect(
            (await post('approve', { userCode: challenge.userCode, remember: true })).status,
        ).toBe(400)
        expect((await post('token', { deviceToken })).status).toBe(401)
    })
})
