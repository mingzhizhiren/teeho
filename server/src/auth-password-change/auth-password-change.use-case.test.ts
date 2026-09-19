import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createPasswordChangeCoordinator } from './auth-password-change.coordinator'
import { createPasswordChangeUseCase } from './auth-password-change.use-case'

const input = {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    clientIp: '203.0.113.8',
    password: {
        currentPassword: 'current123',
        newPassword: 'changed456',
        confirmPassword: 'changed456',
    },
}

function dependencies() {
    return {
        resolveAccount: vi.fn().mockResolvedValue({
            success: true,
            data: { id: 'account-1', email: 'user@example.test', canChangePassword: true },
        }),
        updateCredential: vi
            .fn()
            .mockResolvedValue({ success: true, data: { userId: 'account-1' } }),
        checkThrottle: vi.fn().mockResolvedValue('allowed' as const),
        recordInvalidPassword: vi.fn().mockResolvedValue('allowed' as const),
        invalidateAgentTurn: vi.fn().mockResolvedValue(1),
        coordinator: createPasswordChangeCoordinator(),
    }
}

describe('Auth 修改密码用例 Interface', () => {
    beforeEach(() => vi.clearAllMocks())

    it('成功只执行一次凭证副作用并使当前 Agent 回合失效', async () => {
        const deps = dependencies()
        const useCase = createPasswordChangeUseCase(deps)

        await expect(useCase.execute(input)).resolves.toEqual({ kind: 'changed' })
        expect(deps.updateCredential).toHaveBeenCalledOnce()
        expect(deps.invalidateAgentTurn).toHaveBeenCalledWith('account-1', 'access-token')
        expect(deps.recordInvalidPassword).not.toHaveBeenCalled()
    })

    it('只有确定的当前密码错误进入独立失败窗口', async () => {
        const deps = dependencies()
        deps.updateCredential.mockResolvedValue({
            success: false,
            code: 4000,
            message: '当前密码错误',
            reason: 'invalid_current_password',
        })
        const useCase = createPasswordChangeUseCase(deps)

        await expect(useCase.execute(input)).resolves.toEqual({ kind: 'invalid_current_password' })
        expect(deps.recordInvalidPassword).toHaveBeenCalledWith({
            userId: 'account-1',
            clientIp: input.clientIp,
        })
        expect(deps.invalidateAgentTurn).not.toHaveBeenCalled()
    })

    it.each(['provider_rate_limited', 'provider_unavailable', 'result_unknown'] as const)(
        '%s 不计入旧密码错误',
        async (reason) => {
            const deps = dependencies()
            deps.updateCredential.mockResolvedValue({
                success: false,
                code: 5000,
                message: '密码服务暂不可用',
                reason,
            })
            const useCase = createPasswordChangeUseCase(deps)

            await expect(useCase.execute(input)).resolves.toEqual({ kind: reason })
            expect(deps.recordInvalidPassword).not.toHaveBeenCalled()
            expect(deps.invalidateAgentTurn).not.toHaveBeenCalled()
        },
    )

    it('账号或 IP 已限制时不调用 Provider', async () => {
        const deps = dependencies()
        deps.checkThrottle.mockResolvedValue('limited')

        await expect(createPasswordChangeUseCase(deps).execute(input)).resolves.toEqual({
            kind: 'rate_limited',
        })
        expect(deps.updateCredential).not.toHaveBeenCalled()
    })

    it('限流存储异常时 fail closed，不调用 Provider', async () => {
        const deps = dependencies()
        deps.checkThrottle.mockResolvedValue('unavailable')

        await expect(createPasswordChangeUseCase(deps).execute(input)).resolves.toEqual({
            kind: 'provider_unavailable',
        })
        expect(deps.updateCredential).not.toHaveBeenCalled()
    })

    it('同账号并发第二次提交立即返回进行中，且不重放密码', async () => {
        const deps = dependencies()
        let releaseProvider!: () => void
        deps.updateCredential.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    releaseProvider = () =>
                        resolve({ success: true, data: { userId: 'account-1' } })
                }),
        )
        const useCase = createPasswordChangeUseCase(deps)
        const first = useCase.execute(input)
        await vi.waitFor(() => expect(deps.updateCredential).toHaveBeenCalledOnce())

        await expect(useCase.execute(input)).resolves.toEqual({ kind: 'in_progress' })
        expect(deps.updateCredential).toHaveBeenCalledOnce()

        releaseProvider()
        await expect(first).resolves.toEqual({ kind: 'changed' })
    })

    it('凭证已更新但 Agent 失效门禁失败时按结果未知结束会话', async () => {
        const deps = dependencies()
        deps.invalidateAgentTurn.mockRejectedValue(new Error('database unavailable'))

        await expect(createPasswordChangeUseCase(deps).execute(input)).resolves.toEqual({
            kind: 'result_unknown',
        })
        expect(deps.updateCredential).toHaveBeenCalledOnce()
    })
})
