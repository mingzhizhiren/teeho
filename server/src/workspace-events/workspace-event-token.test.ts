import { describe, expect, it } from 'vitest'

import {
    createWorkspaceEventToken,
    verifyWorkspaceEventToken,
} from '@teeho/community-server/workspace-events/workspace-event-token'

const userId = '00000000-0000-4000-8000-000000000001'
const secret = 'workspace-event-test-secret-with-sufficient-entropy'

describe('workspace SSE bearer credential', () => {
    it('binds a short-lived signed token to the verified user', () => {
        const token = createWorkspaceEventToken(userId, {
            secret,
            now: new Date('2026-08-02T10:00:00.000Z'),
        })

        expect(
            verifyWorkspaceEventToken(token, {
                secret,
                now: new Date('2026-08-02T10:00:30.000Z'),
            }),
        ).toEqual({ userId, expiresAt: '2026-08-02T10:01:00.000Z' })
    })

    it('rejects tampering and expiration', () => {
        const token = createWorkspaceEventToken(userId, {
            secret,
            now: new Date('2026-08-02T10:00:00.000Z'),
        })

        expect(
            verifyWorkspaceEventToken(`${token}x`, {
                secret,
                now: new Date('2026-08-02T10:00:30.000Z'),
            }),
        ).toBeNull()
        expect(
            verifyWorkspaceEventToken(token, {
                secret,
                now: new Date('2026-08-02T10:01:01.000Z'),
            }),
        ).toBeNull()
    })
})
