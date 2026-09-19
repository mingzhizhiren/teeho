import { describe, expect, it } from 'vitest'
import { createSkillAuthController } from '@teeho/community-server/skill-auth/skill-auth.controller'
import { createSkillAuthRoutes } from '@teeho/community-server/skill-auth/skill-auth.routes'
import { MemorySkillStore } from '@teeho/community-server/skill-auth/skill-auth.test-store'

describe('Skill 正式设备授权 HTTP', () => {
    it('同IP第20个匿名账号允许，第21个拒绝', async () => {
        const controller = createSkillAuthController({
            store: new MemorySkillStore(),
            now: Date.now,
            origin: 'http://localhost',
            resolveBrowser: async () => null,
            findUser: async () => null,
            createAnonymous: async (id) => ({
                id,
                email: null,
                canChangePassword: false,
                isAnonymous: true,
            }),
        })
        const app = createSkillAuthRoutes(controller)
        for (let i = 1; i <= 21; i++) {
            const token = i.toString(16).padStart(64, '0')
            const result = await app.handle(
                new Request('http://localhost/skill/auth/anonymous', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        deviceToken: token,
                        machineId: token,
                        deviceName: 'test',
                    }),
                }),
            )
            expect(result.status).toBe(i === 21 ? 429 : 200)
        }
    })
    it('网页只能撤销自己的设备，撤销后凭据不可续期', async () => {
        const user = {
            id: crypto.randomUUID(),
            email: 'owner@example.test',
            canChangePassword: true,
        }
        const other = { ...user, id: crypto.randomUUID() }
        const controller = createSkillAuthController({
            store: new MemorySkillStore(),
            now: Date.now,
            origin: 'http://localhost',
            resolveBrowser: async (token) =>
                token === 'owner' ? user : token === 'other' ? other : null,
            findUser: async () => user,
        })
        const app = createSkillAuthRoutes(controller)
        const call = (path: string, body?: unknown, cookie = 'owner') =>
            app.handle(
                new Request('http://localhost/skill/auth/' + path, {
                    method: body ? 'POST' : 'GET',
                    headers: {
                        'content-type': 'application/json',
                        origin: 'http://localhost',
                        cookie: 'teeho_access_token=' + cookie,
                    },
                    body: body ? JSON.stringify(body) : undefined,
                }),
            )
        const deviceToken = 'c'.repeat(64)
        const challenge = (
            await (await call('start', { deviceToken, deviceName: 'my device' })).json()
        ).data
        await call('approve', { userCode: challenge.userCode, remember: true })
        const devices = await call('devices')
        expect(devices.status).toBe(200)
        const id = (await devices.json()).data.devices[0].id
        expect((await call('revoke', { id }, 'other')).status).toBe(403)
        expect((await call('revoke', { id })).status).toBe(200)
        expect((await call('token', { deviceToken })).status).toBe(401)
    })
    it('匿名创建重试返回同一账号，同一机器跨日也不能重复创建', async () => {
        let now = Date.parse('2026-09-08T00:00:00Z')
        const controller = createSkillAuthController({
            store: new MemorySkillStore(),
            now: () => now,
            origin: 'http://localhost',
            resolveBrowser: async () => null,
            findUser: async () => null,
            createAnonymous: async (id) => ({
                id,
                email: `anonymous@anonymous-${id}.teeho`,
                canChangePassword: false,
                isAnonymous: true,
            }),
        })
        const app = createSkillAuthRoutes(controller)
        const send = (secret: string, machineId = 'b'.repeat(64)) =>
            app.handle(
                new Request('http://localhost/skill/auth/anonymous', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        deviceToken: secret.repeat(64),
                        machineId,
                        deviceName: 'test',
                    }),
                }),
            )
        const first = await send('a')
        expect(first.status).toBe(200)
        const user = (await first.json()).data.user
        expect((await (await send('a')).json()).data.user).toEqual(user)
        expect((await send('c')).status).toBe(429)
        now += 86_400_000
        expect((await send('c')).status).toBe(429)
        expect((await (await send('a')).json()).data.user).toEqual(user)
        expect((await send('d', '')).status).toBe(400)
    })
    it('DEBUG 跳过匿名机器和IP创建限额，但请求仍校验输入和重试身份', async () => {
        const app = createSkillAuthRoutes(
            createSkillAuthController({
                store: new MemorySkillStore(),
                debug: true,
                now: Date.now,
                origin: 'http://localhost',
                resolveBrowser: async () => null,
                findUser: async () => null,
                createAnonymous: async (id) => ({
                    id,
                    email: null,
                    canChangePassword: false,
                    isAnonymous: true,
                }),
            }),
        )
        const send = (index: number, machineId = 'b'.repeat(64)) =>
            app.handle(
                new Request('http://localhost/skill/auth/anonymous', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        deviceToken: index.toString(16).padStart(64, '0'),
                        machineId,
                        deviceName: 'test',
                    }),
                }),
            )
        const ids = new Set<string>()
        for (let index = 1; index <= 21; index++) {
            const response = await send(index)
            expect(response.status).toBe(200)
            ids.add((await response.json()).data.user.id)
        }
        expect(ids.size).toBe(21)
        const retry = await send(1)
        expect(ids.has((await retry.json()).data.user.id)).toBe(true)
        expect((await send(1, 'c'.repeat(64))).status).toBe(429)
        expect((await send(22, '')).status).toBe(400)
    })
    it('临时授权可取得身份，24小时后不能再续期', async () => {
        let now = Date.parse('2026-09-08T00:00:00Z')
        const user = {
            id: '00000000-0000-4000-8000-000000000001',
            email: 'test@example.test',
            canChangePassword: true,
        }
        const controller = createSkillAuthController({
            store: new MemorySkillStore(),
            now: () => now,
            origin: 'http://localhost',
            resolveBrowser: async (token) => (token === 'browser' ? user : null),
            findUser: async (id) => (id === user.id ? user : null),
        })
        const app = createSkillAuthRoutes(controller)
        const post = (path: string, body: unknown, browser = false) =>
            app.handle(
                new Request(`http://localhost/skill/auth/${path}`, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        origin: 'http://localhost',
                        ...(browser ? { cookie: 'teeho_access_token=browser' } : {}),
                    },
                    body: JSON.stringify(body),
                }),
            )
        const deviceToken = 'a'.repeat(64)
        const started = await post('start', { deviceToken, deviceName: 'test device' })
        const challenge = (await started.json()).data
        expect(challenge.verificationUrl).toBe('http://localhost/skill/authorize')
        expect(
            (await post('approve', { userCode: challenge.userCode, remember: false }, true)).status,
        ).toBe(200)
        const issued = await post('token', { deviceToken })
        expect(issued.status).toBe(200)
        expect((await issued.json()).data).toMatchObject({
            user,
            expiresAt: '2026-09-09T00:00:00.000Z',
        })
        now += 86_400_000
        expect((await post('token', { deviceToken })).status).toBe(401)
    })
})
