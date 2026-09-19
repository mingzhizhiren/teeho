import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSkillAuthController } from '@teeho/community-server/skill-auth/skill-auth.controller'
import { MemorySkillStore } from '@teeho/community-server/skill-auth/skill-auth.test-store'

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }))
vi.mock('@teeho/community-server/utils/logger', () => ({ logger: { warn } }))

describe('Skill authorization diagnostic logging', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('logs anonymous provider status/code without sensitive message', async () => {
        const controller = createSkillAuthController({
            store: new MemorySkillStore(),
            now: Date.now,
            origin: 'http://localhost',
            resolveBrowser: async () => null,
            findUser: async () => null,
            createAnonymous: async () => {
                throw Object.assign(new Error('secret provider response'), {
                    status: 503,
                    code: 'unexpected_error',
                })
            },
        })
        const result = await controller.anonymous(
            { deviceToken: 'e'.repeat(64), machineId: 'f'.repeat(64), deviceName: 'test' },
            'ip',
        )
        expect(result.status).toBe(503)
        expect(warn).toHaveBeenCalledWith(
            expect.objectContaining({
                event: 'skill_authorization_failed',
                stage: 'anonymous',
                providerStatus: 503,
                providerCode: 'unexpected_error',
            }),
            expect.any(String),
        )
        expect(JSON.stringify(warn.mock.calls)).not.toContain('secret provider response')
    })

    it('does not add provider fields to non-anonymous failures', async () => {
        const controller = createSkillAuthController({
            store: new MemorySkillStore(),
            now: Date.now,
            origin: 'http://localhost',
            resolveBrowser: async () => {
                throw Object.assign(new Error('secret'), { status: 503, code: 'db_down' })
            },
            findUser: async () => null,
        })
        await controller.devices('token')
        const entry = warn.mock.calls.at(-1)?.[0] as Record<string, unknown>
        expect(entry.stage).toBeUndefined()
        expect(entry.providerStatus).toBeUndefined()
        expect(entry.providerCode).toBeUndefined()
    })
})
