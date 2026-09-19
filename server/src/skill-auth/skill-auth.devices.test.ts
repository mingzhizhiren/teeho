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

describe('设备管理 HTTP 与实际 PostgreSQL 查询', () => {
    beforeAll(async () => {
        await boundary.connection!.exec(
            'create table public.skill_device_grants(id text primary key, payload jsonb not null)',
        )
    })
    afterAll(async () => {
        await boundary.connection?.close()
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
