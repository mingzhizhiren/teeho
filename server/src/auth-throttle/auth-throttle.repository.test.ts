import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { hasActiveLoginThrottle, recordLoginThrottleFailure } from './auth-throttle.repository'
import { db } from '../db/database'

vi.mock('../db/database', () => ({
    db: { execute: vi.fn() },
}))

const keys = [
    {
        scope: 'identifier' as const,
        keyHash: 'a'.repeat(64),
        attemptLimit: 5,
    },
    {
        scope: 'device' as const,
        keyHash: 'b'.repeat(64),
        attemptLimit: 10,
    },
]

describe('登录限流持久化', () => {
    const execute = vi.mocked(db.execute)

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('只读检查不更新锁定期限', async () => {
        execute.mockResolvedValue([{ blocked: true }] as never)

        await expect(hasActiveLoginThrottle(keys)).resolves.toBe(true)

        const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0] as SQL)
        expect(query.sql).toContain('SELECT EXISTS')
        expect(query.sql).not.toContain('UPDATE public.auth_login_throttles')
    })

    it('使用单条 UPSERT 原子累计所有维度', async () => {
        execute.mockResolvedValue([{ locked: false }, { locked: false }] as never)

        await expect(recordLoginThrottleFailure(keys, 300_000, 300_000)).resolves.toBe(false)

        const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0] as SQL)
        expect(query.sql).toContain('ON CONFLICT (scope, key_hash) DO UPDATE')
        expect(query.params).toContain(5)
        expect(query.params).toContain(10)
    })

    it('并发中有维度未更新时按仍处于限制期处理', async () => {
        execute.mockResolvedValue([{ locked: false }] as never)

        await expect(recordLoginThrottleFailure(keys, 300_000, 300_000)).resolves.toBe(true)
    })
})
