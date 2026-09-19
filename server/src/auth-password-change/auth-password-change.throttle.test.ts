import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
    checkPasswordChangeThrottle,
    recordInvalidCurrentPassword,
} from './auth-password-change.throttle'
import {
    hasActivePasswordChangeThrottle,
    recordPasswordChangeFailure,
} from './auth-password-change.repository'

vi.mock('./auth-password-change.repository', () => ({
    hasActivePasswordChangeThrottle: vi.fn(),
    recordPasswordChangeFailure: vi.fn(),
}))

vi.mock('../config/env', () => ({ env: { TEEHO_PWD: 'test-only-secret' } }))
vi.mock('../utils/logger', () => ({ logger: { warn: vi.fn() } }))

const context = { userId: 'account-1', clientIp: '203.0.113.8' }

describe('密码修改独立限流', () => {
    beforeEach(() => vi.clearAllMocks())

    it('以不可逆摘要分别检查账号与 IP，不包含明文标识符', async () => {
        vi.mocked(hasActivePasswordChangeThrottle).mockResolvedValue(false)

        await expect(checkPasswordChangeThrottle(context)).resolves.toBe('allowed')

        const keys = vi.mocked(hasActivePasswordChangeThrottle).mock.calls[0]?.[0] ?? []
        expect(keys.map((key) => key.scope)).toEqual(['account', 'ip'])
        expect(keys.every((key) => /^[a-f0-9]{64}$/u.test(key.keyHash))).toBe(true)
        expect(JSON.stringify(keys)).not.toContain(context.userId)
        expect(JSON.stringify(keys)).not.toContain(context.clientIp)
    })

    it('确定旧密码错误按 15 分钟账号 5 次、IP 20 次累计', async () => {
        vi.mocked(recordPasswordChangeFailure).mockResolvedValue(true)

        await expect(recordInvalidCurrentPassword(context)).resolves.toBe('limited')

        const [keys, windowMs] = vi.mocked(recordPasswordChangeFailure).mock.calls[0] ?? []
        expect(keys?.map(({ scope, attemptLimit }) => ({ scope, attemptLimit }))).toEqual([
            { scope: 'account', attemptLimit: 5 },
            { scope: 'ip', attemptLimit: 20 },
        ])
        expect(windowMs).toBe(900_000)
    })

    it('没有可信 IP 时仍执行账号限制', async () => {
        vi.mocked(hasActivePasswordChangeThrottle).mockResolvedValue(false)

        await checkPasswordChangeThrottle({ userId: context.userId, clientIp: null })

        expect(
            vi.mocked(hasActivePasswordChangeThrottle).mock.calls[0]?.[0].map((key) => key.scope),
        ).toEqual(['account'])
    })

    it('限流存储不可用时 fail closed，且不向调用方抛出内部错误', async () => {
        vi.mocked(hasActivePasswordChangeThrottle).mockRejectedValue(
            new Error('database credentials'),
        )
        vi.mocked(recordPasswordChangeFailure).mockRejectedValue(new Error('database timeout'))

        await expect(checkPasswordChangeThrottle(context)).resolves.toBe('unavailable')
        await expect(recordInvalidCurrentPassword(context)).resolves.toBe('unavailable')
    })
})
