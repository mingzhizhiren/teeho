import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
    signInWithPassword: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
    createClient: vi.fn(() => ({ auth })),
}))

vi.mock('../config/env', () => ({
    env: {
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'publishable-test-key',
    },
}))

import { updatePassword } from './auth.repository'

const input = {
    userId: '00000000-0000-4000-8000-000000000001',
    email: 'user@example.test',
    currentPassword: 'current123',
    newPassword: 'changed456',
}

describe('密码凭证 Repository', () => {
    beforeEach(() => vi.clearAllMocks())

    it('显式重新认证当前密码，错误时绝不调用更新接口', async () => {
        auth.signInWithPassword.mockResolvedValue({
            data: { session: null },
            error: { code: 'invalid_credentials', status: 400 },
        })

        const result = await updatePassword(input)

        expect(auth.signInWithPassword).toHaveBeenCalledWith({
            email: input.email,
            password: input.currentPassword,
        })
        expect(result).toMatchObject({ stage: 'verify', resultUnknown: false })
        expect(auth.updateUser).not.toHaveBeenCalled()
        expect(auth.signOut).not.toHaveBeenCalled()
    })

    it('重新认证必须解析为原账号，不能跨身份更新', async () => {
        auth.signInWithPassword.mockResolvedValue({
            data: {
                session: {
                    user: { id: '00000000-0000-4000-8000-000000000002' },
                },
            },
            error: null,
        })

        const result = await updatePassword(input)

        expect(result).toMatchObject({
            stage: 'verify',
            identityMismatch: true,
            resultUnknown: false,
        })
        expect(auth.updateUser).not.toHaveBeenCalled()
    })

    it('验证同一账号后更新密码并全局撤销刷新会话', async () => {
        auth.signInWithPassword.mockResolvedValue({
            data: { session: { user: { id: input.userId } } },
            error: null,
        })
        auth.updateUser.mockResolvedValue({ error: null })
        auth.signOut.mockResolvedValue({ error: null })

        await expect(updatePassword(input)).resolves.toMatchObject({
            stage: 'complete',
            error: null,
        })
        expect(auth.updateUser).toHaveBeenCalledWith({
            password: input.newPassword,
            current_password: input.currentPassword,
        })
        expect(auth.signOut).toHaveBeenCalledWith({ scope: 'global' })
    })
})
