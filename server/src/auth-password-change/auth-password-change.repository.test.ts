import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../db/database'
import {
    hasActivePasswordChangeThrottle,
    recordPasswordChangeFailure,
} from './auth-password-change.repository'

vi.mock('../db/database', () => ({
    db: { execute: vi.fn() },
}))

const keys = [
    { scope: 'account' as const, keyHash: 'a'.repeat(64), attemptLimit: 5 },
    { scope: 'ip' as const, keyHash: 'b'.repeat(64), attemptLimit: 20 },
]

describe('密码修改独立限流持久化', () => {
    const execute = vi.mocked(db.execute)

    beforeEach(() => vi.clearAllMocks())

    it('只读取密码修改表，不消费普通登录限流', async () => {
        execute.mockResolvedValue([{ blocked: false }] as never)

        await expect(hasActivePasswordChangeThrottle(keys)).resolves.toBe(false)

        const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0] as SQL)
        expect(query.sql).toContain('public.auth_password_change_throttles')
        expect(query.sql).not.toContain('auth_login_throttles')
        expect(query.sql).not.toContain('UPDATE')
    })

    it('单条 UPSERT 原子累计账号和 IP，达到任一阈值即限制', async () => {
        execute.mockResolvedValue([{ limited: true }, { limited: false }] as never)

        await expect(recordPasswordChangeFailure(keys, 900_000)).resolves.toBe(true)

        const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0] as SQL)
        expect(query.sql).toContain('ON CONFLICT (scope, key_hash) DO UPDATE')
        expect(query.sql).toContain('window_started_at')
        expect(query.sql).toContain("interval '1 millisecond'")
        expect(query.sql).not.toContain('make_interval')
        expect(query.sql).toContain('::integer')
        expect(query.params).toContain(5)
        expect(query.params).toContain(20)
        expect(query.params).toContain(900_000)
    })

    it('并发中有维度未更新时保守判定为已限制', async () => {
        execute.mockResolvedValue([{ limited: false }] as never)

        await expect(recordPasswordChangeFailure(keys, 900_000)).resolves.toBe(true)
    })
})
