import { describe, expect, it } from 'vitest'

import { resolveAuthSessionKey } from './auth.session-key'

function jwt(payload: Record<string, unknown>) {
    return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`
}

describe('auth session key', () => {
    it('uses the Supabase session id across access-token rotations', () => {
        const sessionId = '00000000-0000-4000-8000-000000000001'
        expect(resolveAuthSessionKey(jwt({ session_id: sessionId, iat: 1 }))).toBe(
            `session:${sessionId}`,
        )
        expect(resolveAuthSessionKey(jwt({ session_id: sessionId, iat: 2 }))).toBe(
            `session:${sessionId}`,
        )
    })

    it('falls back to a stable one-way token digest for legacy test tokens', () => {
        const key = resolveAuthSessionKey('verified-token')
        expect(key).toMatch(/^token:[0-9a-f]{64}$/u)
        expect(key).toBe(resolveAuthSessionKey('verified-token'))
        expect(key).not.toBe(resolveAuthSessionKey('another-token'))
    })
})
