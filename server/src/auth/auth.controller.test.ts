import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    cleanupAssets: vi.fn(),
    getCurrentUser: vi.fn(),
    invalidateTurns: vi.fn(),
    logout: vi.fn(),
    renewSession: vi.fn(),
}))

vi.mock('../analysis/media/analysis.asset-lifecycle.service', () => ({
    requestAnalysisUserAssetCleanupBestEffort: mocks.cleanupAssets,
}))
vi.mock('../analysis/conversation/analysis.conversation-turn-run.service', () => ({
    analysisConversationTurnRunService: {
        invalidateUser: mocks.invalidateTurns,
        invalidateUserBestEffort: vi.fn(),
    },
}))
vi.mock('./auth.service', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./auth.service')>()),
    getCurrentUser: mocks.getCurrentUser,
    logout: mocks.logout,
    renewSession: mocks.renewSession,
}))

import { handleLogout } from './auth.controller'
import { resolveAuthSessionKey } from './auth.session-key'

describe('auth controller logout cleanup ordering', () => {
    beforeEach(() => vi.clearAllMocks())

    it('resolves the account and invalidates temporary turns before revoking the provider session', async () => {
        mocks.invalidateTurns.mockResolvedValueOnce(1)
        let resolveUser!: (value: unknown) => void
        mocks.getCurrentUser.mockReturnValueOnce(
            new Promise((resolve) => {
                resolveUser = resolve
            }),
        )

        const logoutResponse = handleLogout('access-token', 'refresh-token', {
            cleanupCloudAssets: false,
        })
        await Promise.resolve()
        expect(mocks.logout).not.toHaveBeenCalled()

        resolveUser({ success: true, data: { id: 'user-1' } })
        await expect(logoutResponse).resolves.toMatchObject({ status: 200 })
        await vi.waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce())

        expect(mocks.invalidateTurns).toHaveBeenCalledWith(
            'user-1',
            resolveAuthSessionKey('access-token'),
        )
        expect(mocks.invalidateTurns.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.logout.mock.invocationCallOrder[0]!,
        )
    })

    it('uses a valid refresh session to invalidate turns when the access token expired', async () => {
        mocks.getCurrentUser.mockResolvedValueOnce({ success: false })
        mocks.renewSession.mockResolvedValueOnce({
            success: true,
            data: {
                accessToken: 'renewed-access',
                refreshToken: 'renewed-refresh',
                expiresIn: 3600,
                user: { id: 'user-2', email: 'user@example.test' },
            },
        })
        mocks.invalidateTurns.mockResolvedValueOnce(1)

        await expect(
            handleLogout('expired-access', 'valid-refresh', { cleanupCloudAssets: false }),
        ).resolves.toMatchObject({ status: 200 })
        await vi.waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce())

        expect(mocks.invalidateTurns).toHaveBeenCalledWith(
            'user-2',
            resolveAuthSessionKey('renewed-access'),
        )
        expect(mocks.logout).toHaveBeenCalledWith('renewed-access', 'renewed-refresh')
    })

    it('uses the refresh session when the browser no longer has an access cookie', async () => {
        mocks.renewSession.mockResolvedValueOnce({
            success: true,
            data: {
                accessToken: 'refresh-only-access',
                refreshToken: 'refresh-only-refresh',
                expiresIn: 3600,
                user: { id: 'user-3', email: 'user3@example.test' },
            },
        })
        mocks.invalidateTurns.mockResolvedValueOnce(1)

        await expect(
            handleLogout('', 'valid-refresh', { cleanupCloudAssets: false }),
        ).resolves.toMatchObject({ status: 200 })
        await vi.waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce())

        expect(mocks.getCurrentUser).not.toHaveBeenCalled()
        expect(mocks.invalidateTurns).toHaveBeenCalledWith(
            'user-3',
            resolveAuthSessionKey('refresh-only-access'),
        )
        expect(mocks.logout).toHaveBeenCalledWith('refresh-only-access', 'refresh-only-refresh')
    })

    it('does not revoke the retryable session when the durable logout guard fails', async () => {
        mocks.getCurrentUser.mockResolvedValueOnce({
            success: true,
            data: { id: 'user-4', email: 'user4@example.test' },
        })
        mocks.invalidateTurns.mockRejectedValueOnce(new Error('database unavailable'))

        await expect(
            handleLogout('guard-access', 'guard-refresh', { cleanupCloudAssets: false }),
        ).resolves.toMatchObject({ status: 503 })

        expect(mocks.logout).not.toHaveBeenCalled()
        expect(mocks.cleanupAssets).not.toHaveBeenCalled()
    })
})
