import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getUserById, createUser, warn } = vi.hoisted(() => ({
    getUserById: vi.fn(),
    createUser: vi.fn(),
    warn: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({
    createClient: () => ({ auth: { admin: { getUserById, createUser } } }),
}))
vi.mock('./skill-auth.repository', async () => {
    const { MemorySkillStore } = await import('./skill-auth.test-store')
    return { PostgresSkillStore: MemorySkillStore }
})
vi.mock('../utils/logger', () => ({ logger: { warn } }))

const anonymousUser = {
    id: '00000000-0000-4000-8000-000000000001',
    email: null,
    app_metadata: { teeho_skill_anonymous: true },
}
const success = { data: { user: anonymousUser }, error: null }
const networkFailure = {
    data: { user: null },
    error: { status: 0, name: 'AuthRetryableFetchError', message: 'secret connection details' },
}

async function authorize(): Promise<{ status: number }> {
    const { skillAuthController } = await import('./skill-auth.runtime')
    const pending = skillAuthController.anonymous(
        { deviceToken: 'e'.repeat(64), machineId: 'f'.repeat(64), deviceName: 'test' },
        'test-ip',
    )
    await vi.runAllTimersAsync()
    return pending
}

describe('匿名授权上游读取恢复', () => {
    beforeEach(() => {
        vi.resetModules()
        vi.resetAllMocks()
        vi.useFakeTimers()
    })
    afterEach(() => vi.useRealTimers())

    it('只读查询瞬时断连后恢复，不重复创建匿名账号', async () => {
        getUserById.mockResolvedValueOnce(networkFailure).mockResolvedValue(success)
        expect((await authorize()).status).toBe(200)
        expect(getUserById).toHaveBeenCalledTimes(2)
        expect(createUser).not.toHaveBeenCalled()
        expect(JSON.stringify(warn.mock.calls)).not.toContain('secret connection details')
    })

    it('持续断连在三次读取后返回503，不无限重试', async () => {
        getUserById.mockResolvedValue(networkFailure)
        expect((await authorize()).status).toBe(503)
        expect(getUserById).toHaveBeenCalledTimes(3)
        expect(createUser).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalledWith(
            expect.objectContaining({ errorName: 'AuthRetryableFetchError' }),
            expect.any(String),
        )
    })

    it('凭据拒绝不重试', async () => {
        getUserById.mockResolvedValue({ data: { user: null }, error: { status: 401 } })
        expect((await authorize()).status).toBe(503)
        expect(getUserById).toHaveBeenCalledTimes(1)
        expect(createUser).not.toHaveBeenCalled()
    })

    it('创建响应丢失后查询固定账号恢复，不重发创建', async () => {
        getUserById
            .mockResolvedValueOnce({ data: { user: null }, error: { status: 404 } })
            .mockResolvedValueOnce(networkFailure)
            .mockResolvedValue(success)
        createUser.mockResolvedValue(networkFailure)
        expect((await authorize()).status).toBe(200)
        expect(createUser).toHaveBeenCalledTimes(1)
        const requestedIds = getUserById.mock.calls.map(([id]) => id)
        expect(new Set(requestedIds).size).toBe(1)
    })
})
