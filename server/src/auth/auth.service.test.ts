import { beforeEach, describe, expect, it, vi } from 'vitest'
import { API_CODES } from '../config/constants'
import { getUser, signInWithPassword, signUpWithPassword, updatePassword } from './auth.repository'
import { changePassword, getCurrentUser, login, register } from './auth.service'
import { loginWithThrottle } from './auth.service'
import {
    clearLoginIdentifierThrottle,
    isLoginAttemptBlocked,
    recordLoginFailure,
} from '../auth-throttle/auth-throttle.service'

vi.mock('./auth.repository', () => ({
    createGoogleAuthorization: vi.fn(),
    exchangeGoogleAuthorizationCode: vi.fn(),
    getUser: vi.fn(),
    refreshSession: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    signUpWithPassword: vi.fn(),
    updatePassword: vi.fn(),
}))

vi.mock('../utils/logger', () => ({
    logger: { warn: vi.fn() },
}))

vi.mock('../auth-throttle/auth-throttle.service', () => ({
    clearLoginIdentifierThrottle: vi.fn(),
    isLoginAttemptBlocked: vi.fn(),
    recordLoginFailure: vi.fn(),
}))

const authUser = {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'tester@example.com',
    app_metadata: {},
    identities: [{ provider: 'email' }],
}

describe('login', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('logs in with an email and returns the verified Supabase user', async () => {
        vi.mocked(signInWithPassword).mockResolvedValue({
            data: {
                session: {
                    access_token: 'access-token',
                    refresh_token: 'refresh-token',
                    expires_in: 3600,
                    user: authUser,
                },
            },
            error: null,
        } as never)

        const result = await login({ email: 'tester@example.com', password: 'password123' })

        expect(signInWithPassword).toHaveBeenCalledWith({
            email: 'tester@example.com',
            password: 'password123',
        })
        expect(result).toEqual({
            success: true,
            data: {
                accessToken: 'access-token',
                refreshToken: 'refresh-token',
                expiresIn: 3600,
                user: {
                    id: authUser.id,
                    email: 'tester@example.com',
                    canChangePassword: true,
                },
            },
        })
    })

    it('returns a generic response for invalid credentials', async () => {
        vi.mocked(signInWithPassword).mockResolvedValue({
            data: { session: null, user: null },
            error: { code: 'invalid_credentials', status: 400 },
        } as never)

        const result = await login({
            email: 'tester@example.com',
            password: 'wrong-password',
        })

        expect(result).toEqual({
            success: false,
            code: API_CODES.UNAUTHORIZED,
            message: '邮箱或密码错误',
        })
    })

    it('separates a Supabase outage from invalid credentials without leaking details', async () => {
        vi.mocked(signInWithPassword).mockResolvedValue({
            data: { session: null, user: null },
            error: { code: 'unexpected_failure', status: 503 },
        } as never)

        const result = await login({ email: 'tester@example.com', password: 'password123' })

        expect(result).toEqual({
            success: false,
            code: API_CODES.INTERNAL_ERROR,
            message: '登录服务暂不可用，请稍后重试',
        })
    })

    it('rejects a session that does not match the resolved backend identity', async () => {
        vi.mocked(signInWithPassword).mockResolvedValue({
            data: {
                session: {
                    access_token: 'access-token',
                    refresh_token: 'refresh-token',
                    expires_in: 3600,
                    user: {
                        ...authUser,
                        email: 'other@example.com',
                    },
                },
            },
            error: null,
        } as never)

        const result = await login({ email: 'tester@example.com', password: 'password123' })

        expect(result).toEqual({
            success: false,
            code: API_CODES.INTERNAL_ERROR,
            message: '登录服务暂不可用，请稍后重试',
        })
    })

    it('restores the verified Supabase user email', async () => {
        vi.mocked(getUser).mockResolvedValue({
            data: { user: authUser },
            error: null,
        } as never)

        const result = await getCurrentUser('access-token')

        expect(result).toEqual({
            success: true,
            data: {
                id: authUser.id,
                email: 'tester@example.com',
                canChangePassword: true,
            },
        })
    })
})

describe('changePassword', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('密码凭证账号使用当前密码更新并全局撤销会话', async () => {
        vi.mocked(getUser).mockResolvedValue({
            data: { user: authUser },
            error: null,
        } as never)
        vi.mocked(updatePassword).mockResolvedValue({
            error: null,
            stage: 'complete',
            resultUnknown: false,
            transportFailed: false,
        } as never)

        const result = await changePassword('access-token', 'refresh-token', {
            currentPassword: 'current123',
            newPassword: 'changed456',
            confirmPassword: 'changed456',
        })

        expect(updatePassword).toHaveBeenCalledWith({
            userId: authUser.id,
            email: authUser.email,
            currentPassword: 'current123',
            newPassword: 'changed456',
        })
        expect(result).toEqual({ success: true, data: { userId: authUser.id } })
    })

    it('OAuth-only 账号拒绝创建站内密码', async () => {
        vi.mocked(getUser).mockResolvedValue({
            data: {
                user: {
                    ...authUser,
                    identities: [{ provider: 'google' }],
                },
            },
            error: null,
        } as never)

        const result = await changePassword('access-token', 'refresh-token', {
            currentPassword: 'current123',
            newPassword: 'changed456',
            confirmPassword: 'changed456',
        })

        expect(result).toMatchObject({ success: false, code: API_CODES.FORBIDDEN })
        expect(updatePassword).not.toHaveBeenCalled()
    })

    it.each(['current_password_invalid', 'invalid_credentials'])(
        '只把 Provider 的 %s 归类为确定的当前密码错误',
        async (code) => {
            vi.mocked(getUser).mockResolvedValue({
                data: { user: authUser },
                error: null,
            } as never)
            vi.mocked(updatePassword).mockResolvedValue({
                error: { code, status: 400 },
                stage: 'update',
                resultUnknown: false,
            } as never)

            await expect(
                changePassword('access-token', 'refresh-token', {
                    currentPassword: 'wrong-password',
                    newPassword: 'changed456',
                    confirmPassword: 'changed456',
                }),
            ).resolves.toMatchObject({
                success: false,
                reason: 'invalid_current_password',
            })
        },
    )

    it('Provider 限流与密码强度失败使用不同分类', async () => {
        vi.mocked(getUser).mockResolvedValue({
            data: { user: authUser },
            error: null,
        } as never)
        vi.mocked(updatePassword)
            .mockResolvedValueOnce({
                error: { code: 'over_request_rate_limit', status: 429 },
                stage: 'update',
                resultUnknown: false,
            } as never)
            .mockResolvedValueOnce({
                error: { code: 'weak_password', status: 422 },
                stage: 'update',
                resultUnknown: false,
            } as never)

        await expect(
            changePassword('access-token', 'refresh-token', {
                currentPassword: 'current123',
                newPassword: 'changed456',
                confirmPassword: 'changed456',
            }),
        ).resolves.toMatchObject({ success: false, reason: 'provider_rate_limited' })
        await expect(
            changePassword('access-token', 'refresh-token', {
                currentPassword: 'current123',
                newPassword: 'changed456',
                confirmPassword: 'changed456',
            }),
        ).resolves.toMatchObject({ success: false, reason: 'invalid_new_password' })
    })

    it('密码更新传输中断或更新后撤销失败标记为结果未知', async () => {
        vi.mocked(getUser).mockResolvedValue({
            data: { user: authUser },
            error: null,
        } as never)
        vi.mocked(updatePassword)
            .mockRejectedValueOnce(new Error('socket closed'))
            .mockResolvedValueOnce({
                error: { code: 'unexpected_failure', status: 503 },
                stage: 'revoke',
                resultUnknown: true,
            } as never)

        await expect(
            changePassword('access-token', 'refresh-token', {
                currentPassword: 'current123',
                newPassword: 'changed456',
                confirmPassword: 'changed456',
            }),
        ).resolves.toMatchObject({ success: false, reason: 'result_unknown' })
        await expect(
            changePassword('access-token', 'refresh-token', {
                currentPassword: 'current123',
                newPassword: 'changed456',
                confirmPassword: 'changed456',
            }),
        ).resolves.toMatchObject({ success: false, reason: 'result_unknown' })
    })
})

describe('loginWithThrottle', () => {
    const throttleContext = {
        clientIp: '203.0.113.7',
        deviceToken: 'signed-device-token',
    }

    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(isLoginAttemptBlocked).mockResolvedValue(false)
        vi.mocked(recordLoginFailure).mockResolvedValue(false)
        vi.mocked(clearLoginIdentifierThrottle).mockResolvedValue()
    })

    it('已受限时不再调用 Supabase，也不继续写失败次数', async () => {
        vi.mocked(isLoginAttemptBlocked).mockResolvedValue(true)

        const result = await loginWithThrottle(
            { email: 'tester@example.com', password: 'wrong-password' },
            throttleContext,
        )

        expect(result).toEqual({
            success: false,
            code: API_CODES.RATE_LIMITED,
            message: '登录尝试过多，请 5 分钟后再试',
        })
        expect(signInWithPassword).not.toHaveBeenCalled()
        expect(recordLoginFailure).not.toHaveBeenCalled()
    })

    it('本次错误达到阈值时返回统一限制提示', async () => {
        vi.mocked(signInWithPassword).mockResolvedValue({
            data: { session: null, user: null },
            error: { code: 'invalid_credentials', status: 400 },
        } as never)
        vi.mocked(recordLoginFailure).mockResolvedValue(true)

        const result = await loginWithThrottle(
            { email: 'tester@example.com', password: 'wrong-password' },
            throttleContext,
        )

        expect(result).toEqual({
            success: false,
            code: API_CODES.RATE_LIMITED,
            message: '登录尝试过多，请 5 分钟后再试',
        })
    })

    it('成功后只请求清除账号失败记录', async () => {
        vi.mocked(signInWithPassword).mockResolvedValue({
            data: {
                session: {
                    access_token: 'access-token',
                    refresh_token: 'refresh-token',
                    expires_in: 3600,
                    user: authUser,
                },
            },
            error: null,
        } as never)

        const result = await loginWithThrottle(
            { email: 'tester@example.com', password: 'password123' },
            throttleContext,
        )

        expect(result.success).toBe(true)
        expect(clearLoginIdentifierThrottle).toHaveBeenCalledWith('tester@example.com')
        expect(recordLoginFailure).not.toHaveBeenCalled()
    })

    it('Supabase 服务异常不计为密码失败', async () => {
        vi.mocked(signInWithPassword).mockResolvedValue({
            data: { session: null, user: null },
            error: { code: 'unexpected_failure', status: 503 },
        } as never)

        const result = await loginWithThrottle(
            { email: 'tester@example.com', password: 'password123' },
            throttleContext,
        )

        expect(result).toEqual({
            success: false,
            code: API_CODES.INTERNAL_ERROR,
            message: '登录服务暂不可用，请稍后重试',
        })
        expect(recordLoginFailure).not.toHaveBeenCalled()
    })
})

describe('register', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('does not expose whether an email already exists', async () => {
        vi.mocked(signUpWithPassword).mockResolvedValue({
            data: { user: null, session: null },
            error: { code: 'user_already_exists' },
        } as never)

        const result = await register({ email: 'existing@example.com', password: 'password123' })

        expect(result).toEqual({
            success: true,
            data: {
                user: null,
                session: null,
                requiresEmailConfirmation: true,
            },
        })
    })

    it('does not return an unconfirmed Supabase user to the browser', async () => {
        vi.mocked(signUpWithPassword).mockResolvedValue({
            data: {
                user: {
                    id: '00000000-0000-0000-0000-000000000001',
                    email: 'new@example.com',
                },
                session: null,
            },
            error: null,
        } as never)

        const result = await register({ email: 'new@example.com', password: 'password123' })

        expect(result).toEqual({
            success: true,
            data: {
                user: null,
                session: null,
                requiresEmailConfirmation: true,
            },
        })
    })
})
