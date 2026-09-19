import { describe, expect, test } from 'bun:test'

import {
    formatAgentCooldownDuration,
    resolveDraftSendCooldown,
} from '@/features/analysis/draftSendCooldown'
import { ApiRequestError } from '@/utils/apiRequestError'

describe('draft send cooldown', () => {
    test('uses the server retry boundary and rounds the visible wait up to minutes', () => {
        const cooldown = resolveDraftSendCooldown(
            new ApiRequestError('草稿发送次数已达上限，请稍后再试', {
                code: 4290,
                status: 429,
                data: {
                    retryAfterSeconds: 275,
                    retryAt: '2026-08-05T07:10:00.000Z',
                },
            }),
            new Date('2026-08-05T07:05:25.000Z'),
        )

        expect(cooldown).toEqual({
            reason: 'send_window',
            retryAt: '2026-08-05T07:10:00.000Z',
            retryAtMs: Date.parse('2026-08-05T07:10:00.000Z'),
            remainingSeconds: 275,
            waitMinutes: 5,
            canUpgrade: false,
        })
    })

    test('recognizes rolling account cooldown without exposing token values', () => {
        const cooldown = resolveDraftSendCooldown(
            new ApiRequestError('今日 Agent 使用较多，请稍后再试', {
                code: 4290,
                status: 429,
                data: {
                    reason: 'rolling_agent_usage',
                    retryAfterSeconds: 12_000,
                    retryAt: '2026-08-16T03:20:00.000Z',
                    canUpgrade: true,
                },
            }),
            new Date('2026-08-16T00:00:00.000Z'),
        )

        expect(cooldown).toMatchObject({
            reason: 'rolling_agent_usage',
            remainingSeconds: 12_000,
            waitMinutes: 200,
            canUpgrade: true,
        })
    })

    test('ignores unrelated or expired API errors', () => {
        expect(resolveDraftSendCooldown(new Error('network'), new Date())).toBeNull()
        expect(
            resolveDraftSendCooldown(
                new ApiRequestError('expired', {
                    code: 4290,
                    status: 429,
                    data: {
                        retryAfterSeconds: 0,
                        retryAt: '2026-08-05T07:00:00.000Z',
                    },
                }),
                new Date('2026-08-05T07:00:01.000Z'),
            ),
        ).toBeNull()
    })

    test('formats the rolling wait without exposing its token basis', () => {
        expect(formatAgentCooldownDuration(12_000, 'zh-CN')).toBe('3 小时 20 分钟')
        expect(formatAgentCooldownDuration(12_000, 'en-US')).toBe('3 hours 20 minutes')
    })
})
