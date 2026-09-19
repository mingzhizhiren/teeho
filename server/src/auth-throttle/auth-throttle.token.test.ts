import { describe, expect, it } from 'vitest'

import { resolveLoginDeviceToken, verifyLoginDeviceToken } from './auth-throttle.token'

const secret = 'test-only-auth-throttle-secret'

describe('登录设备令牌', () => {
    it('签发并接受服务端签名的随机令牌', () => {
        const resolved = resolveLoginDeviceToken('', secret)

        expect(resolved.created).toBe(true)
        expect(verifyLoginDeviceToken(resolved.token, secret)).toBe(true)
        expect(resolveLoginDeviceToken(resolved.token, secret)).toEqual({
            token: resolved.token,
            created: false,
        })
    })

    it('拒绝被篡改和随意构造的设备令牌', () => {
        const issued = resolveLoginDeviceToken('', secret).token
        const signatureStart = issued.indexOf('.') + 1
        const replacement = issued[signatureStart] === 'a' ? 'b' : 'a'
        const tampered = `${issued.slice(0, signatureStart)}${replacement}${issued.slice(signatureStart + 1)}`

        expect(verifyLoginDeviceToken(tampered, secret)).toBe(false)
        expect(resolveLoginDeviceToken('attacker-controlled-token', secret).created).toBe(true)
    })
})
