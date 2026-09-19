import { describe, expect, it } from 'vitest'

import { readLoginClientIp } from './auth-throttle.client-ip'

describe('readLoginClientIp', () => {
    it('只在生产请求来自本机反向代理时信任 X-Real-IP', () => {
        const headers = new Headers({ 'x-real-ip': '203.0.113.7' })

        expect(readLoginClientIp(headers, '127.0.0.1', 'production')).toBe('203.0.113.7')
        expect(readLoginClientIp(headers, '198.51.100.9', 'production')).toBe('198.51.100.9')
    })

    it('开发环境忽略可伪造的代理请求头', () => {
        const headers = new Headers({ 'x-real-ip': '203.0.113.7' })

        expect(readLoginClientIp(headers, '192.0.2.8', 'development')).toBe('192.0.2.8')
    })

    it('将 IPv6 地址归一化为 /64 网段', () => {
        expect(
            readLoginClientIp(
                new Headers(),
                '2001:db8:1234:5678:abcd:ef01:2345:6789',
                'development',
            ),
        ).toBe('2001:0db8:1234:5678::/64')
    })

    it('无法取得有效地址时省略 IP 维度', () => {
        expect(readLoginClientIp(new Headers(), '', 'production')).toBeNull()
    })
})
