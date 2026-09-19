import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
    clearLoginIdentifierThrottle,
    isLoginAttemptBlocked,
    recordLoginFailure,
} from './auth-throttle.service'
import {
    clearLoginThrottle,
    hasActiveLoginThrottle,
    recordLoginThrottleFailure,
} from './auth-throttle.repository'

vi.mock('./auth-throttle.repository', () => ({
    clearLoginThrottle: vi.fn(),
    hasActiveLoginThrottle: vi.fn(),
    recordLoginThrottleFailure: vi.fn(),
}))

vi.mock('../config/env', () => ({
    env: {
        TEEHO_PWD: 'test-only-secret',
    },
}))

vi.mock('../utils/logger', () => ({
    logger: { warn: vi.fn() },
}))

const context = {
    clientIp: '203.0.113.7',
    deviceToken: 'signed-device-token',
}

describe('登录限流服务', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('按账号、设备和 IP 三个互不相同的键检查限制', async () => {
        vi.mocked(hasActiveLoginThrottle).mockResolvedValue(false)

        await expect(isLoginAttemptBlocked('Tester@Example.com', context)).resolves.toBe(false)

        const keys = vi.mocked(hasActiveLoginThrottle).mock.calls[0]?.[0] ?? []
        expect(keys.map((key) => key.scope)).toEqual(['identifier', 'device', 'ip'])
        expect(new Set(keys.map((key) => key.keyHash)).size).toBe(3)
        expect(keys.every((key) => /^[a-f0-9]{64}$/u.test(key.keyHash))).toBe(true)
    })

    it('失败时使用各维度阈值，并返回本次是否触发限制', async () => {
        vi.mocked(recordLoginThrottleFailure).mockResolvedValue(true)

        await expect(recordLoginFailure('tester@example.com', context)).resolves.toBe(true)

        const keys = vi.mocked(recordLoginThrottleFailure).mock.calls[0]?.[0] ?? []
        expect(keys.map(({ scope, attemptLimit }) => ({ scope, attemptLimit }))).toEqual([
            { scope: 'identifier', attemptLimit: 5 },
            { scope: 'device', attemptLimit: 10 },
            { scope: 'ip', attemptLimit: 20 },
        ])
    })

    it('首次签发但尚未回传设备令牌时不创建设备聚合键', async () => {
        vi.mocked(recordLoginThrottleFailure).mockResolvedValue(false)

        await recordLoginFailure('tester@example.com', {
            clientIp: context.clientIp,
            deviceToken: null,
        })

        const keys = vi.mocked(recordLoginThrottleFailure).mock.calls[0]?.[0] ?? []
        expect(keys.map((key) => key.scope)).toEqual(['identifier', 'ip'])
    })

    it('登录成功只清除账号维度，不清除设备与 IP 的全局失败窗口', async () => {
        vi.mocked(clearLoginThrottle).mockResolvedValue()

        await clearLoginIdentifierThrottle('tester@example.com')

        expect(clearLoginThrottle).toHaveBeenCalledOnce()
        expect(clearLoginThrottle).toHaveBeenCalledWith(
            expect.objectContaining({ scope: 'identifier' }),
        )
    })
})
