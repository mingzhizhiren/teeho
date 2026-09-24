import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { SQL } from 'drizzle-orm'

const boundary = vi.hoisted(() => ({ connection: undefined as PGlite | undefined }))
vi.mock('../db/database', async () => {
    const { PGlite } = await import('@electric-sql/pglite')
    const { drizzle } = await import('drizzle-orm/pglite')
    const connection = new PGlite()
    boundary.connection = connection
    const database = drizzle(connection)
    return {
        db: { execute: async (query: SQL) => (await database.execute(query)).rows },
        withTransaction: async (
            operation: (executor: {
                execute: (query: SQL) => Promise<Record<string, unknown>[]>
            }) => Promise<unknown>,
        ) =>
            database.transaction((transaction) =>
                operation({
                    execute: async (query: SQL) => (await transaction.execute(query)).rows,
                }),
            ),
    }
})

import { PostgresSkillStore } from '@teeho/community-server/skill-auth/skill-auth.repository'
import { createSkillAuthController } from '@teeho/community-server/skill-auth/skill-auth.controller'
import { createSkillAuthRoutes } from '@teeho/community-server/skill-auth/skill-auth.routes'
import { createSkillAuthService, skillDigest } from './skill-auth.service'

describe('设备管理 HTTP 与实际 PostgreSQL 查询', () => {
    beforeAll(async () => {
        await boundary.connection!.exec(
            'create table public.skill_device_grants(id text primary key, payload jsonb not null)',
        )
        await boundary.connection!.exec(
            'create table public.skill_request_limits(key text primary key, window_id bigint, count integer)',
        )
    })
    afterAll(async () => {
        await boundary.connection?.close()
    })

    it('并发批准后仅保留五个有效授权', async () => {
        const now = Date.parse('2026-09-24T01:00:00Z')
        const user = { id: crypto.randomUUID(), email: null, canChangePassword: true }
        const store = new PostgresSkillStore()
        const ids = Array.from({ length: 7 }, (_, index) => skillDigest(`parallel-${index}`))
        for (const [index, id] of ids.entries()) {
            await store.insert({
                id,
                codeHash: skillDigest(`parallel-code-${index}`),
                deviceName: 'test',
                createdAt: now + index,
                pendingUntil: now + 1000,
                userId: index < 4 ? user.id : null,
                expiresAt: null,
                revoked: false,
                accessHash: null,
                accessUntil: 0,
            })
        }
        const service = createSkillAuthService({
            store,
            now: () => now,
            origin: 'http://localhost',
            resolveBrowser: async () => user,
            findUser: async () => user,
        })
        await Promise.all(
            [4, 5, 6].map((index) =>
                service.approve(`parallel-code-${index}`, true, 'browser', 'parallel-ip'),
            ),
        )
        expect((await store.list(user.id, { now })).map((grant) => grant.id)).toEqual(
            ids.slice(2).reverse(),
        )
    })

    it('第六个授权原子淘汰最旧项，重复批准不淘汰，旧访问凭据立即失效', async () => {
        const now = Date.parse('2026-09-24T00:00:00Z')
        const user = { id: crypto.randomUUID(), email: null, canChangePassword: true }
        const other = crypto.randomUUID()
        const store = new PostgresSkillStore()
        const ids = Array.from({ length: 8 }, (_, index) => skillDigest(`limit-test-${index}`))
        for (const [index, id] of ids.entries())
            await store.insert({
                id,
                codeHash: skillDigest(`code-${index}`),
                deviceName: 'test',
                createdAt: now + index,
                pendingUntil: now + 1000,
                userId: index === 5 ? null : index === 6 ? other : user.id,
                expiresAt: index === 7 ? now : null,
                revoked: false,
                accessHash: skillDigest(`access-${index}`),
                accessUntil: now + 1000,
            })
        const service = createSkillAuthService({
            store,
            now: () => now,
            origin: 'http://localhost',
            resolveBrowser: async () => user,
            findUser: async () => user,
        })
        await service.approve('code-5', true, 'browser', 'ip')
        expect((await store.list(user.id, { now })).map((grant) => grant.id)).toEqual(
            ids.slice(1, 6).reverse(),
        )
        expect(await store.find('id', ids[0]!)).toMatchObject({
            revoked: true,
            accessHash: null,
            accessUntil: 0,
        })
        await expect(service.authenticate('access-0')).rejects.toMatchObject({
            reason: 'authorization_expired',
        })
        expect(await store.find('id', ids[6]!)).toMatchObject({ revoked: false })
        expect(await store.find('id', ids[7]!)).toMatchObject({ revoked: false })
        await service.approve('code-5', true, 'browser', 'ip')
        expect(await store.list(user.id, { now })).toHaveLength(5)
    })

    it('已撤销记录不遮挡有效设备，同一创建时间跨页不遗漏且只能撤销本人设备', async () => {
        const now = Date.parse('2026-09-08T00:00:00Z')
        const user = { id: crypto.randomUUID(), email: null, canChangePassword: true }
        const other = { ...user, id: crypto.randomUUID() }
        const store = new PostgresSkillStore()
        const activeIds = Array.from({ length: 105 }, (_, i) =>
            (i + 1).toString(16).padStart(64, '0'),
        )
        for (let i = 0; i < 207; i++) {
            const id = (i + 1).toString(16).padStart(64, '0')
            await store.insert({
                id,
                codeHash: id,
                deviceName: 'synthetic device',
                createdAt: i < 105 ? now - 1000 : now,
                pendingUntil: now - 1,
                userId: i === 206 ? other.id : user.id,
                expiresAt: null,
                revoked: i >= 105 && i < 206,
                accessHash: null,
                accessUntil: 0,
            })
        }
        const app = createSkillAuthRoutes(
            createSkillAuthController({
                store,
                now: () => now,
                origin: 'http://localhost',
                resolveBrowser: async (token) => (token === 'owner' ? user : other),
                findUser: async () => user,
            }),
        )
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
        const found: string[] = []
        let cursor: string | null = null
        for (let page = 0; page < 4; page++) {
            const result = await call(
                'devices' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
            )
            expect(result.status).toBe(200)
            const data = (await result.json()).data
            found.push(...data.devices.map((device: { id: string }) => device.id))
            cursor = data.nextCursor
            if (!cursor) break
        }
        expect(found.sort()).toEqual(activeIds.sort())
        const oldest = activeIds[0]!
        expect((await call('revoke', { id: oldest }, 'other')).status).toBe(403)
        expect((await call('revoke', { id: oldest })).status).toBe(200)
        expect((await call('devices?cursor=invalid')).status).toBe(400)
    })
})
