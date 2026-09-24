import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const databaseMocks = vi.hoisted(() => ({ execute: vi.fn() }))

vi.mock('../../db/database', () => ({ db: { execute: databaseMocks.execute } }))

import {
    AnalysisConversationBusyError,
    AnalysisConversationStaleError,
    claimAnalysisConversationTurn,
    clearAnalysisConversationControl,
    completeAnalysisConversationTurn,
    getAnalysisConversationControl,
    releaseAnalysisConversationTurn,
    resetAnalysisConversationAfterTaskAdmission,
    submitAnalysisConversationAfterTaskAdmission,
} from './analysis.conversation.repository'

const userId = '00000000-0000-4000-8000-000000000001'
const sessionId = '00000000-0000-4000-8000-000000000002'
const browserInstanceId = '00000000-0000-4000-8000-000000000003'
const leaseId = '00000000-0000-4000-8000-000000000004'

describe('analysis conversation authority repository', () => {
    beforeEach(() => vi.clearAllMocks())

    it.each([
        ['2026-09-24 01:46:16.881473+00', '2026-09-24T01:46:16.881Z'],
        [new Date('2026-09-24T01:46:16.881Z'), '2026-09-24T01:46:16.881Z'],
        [null, null],
    ])('会话租约时间统一输出 ISO 格式：%s', async (leaseExpiresAt, expected) => {
        databaseMocks.execute.mockResolvedValueOnce([
            {
                sessionId,
                generation: 39,
                browserInstanceId,
                status: 'processing',
                contentKind: null,
                leaseExpiresAt,
                consumedTokens: '0',
            },
        ])
        expect((await getAnalysisConversationControl(userId))?.leaseExpiresAt).toBe(expected)
    })

    it('用单条 UPSERT 在租约空闲时接管并只把代数递增一', async () => {
        databaseMocks.execute.mockResolvedValueOnce([
            {
                sessionId,
                generation: '8',
                browserInstanceId,
                status: 'processing',
                contentKind: null,
                leaseId,
                leaseExpiresAt: '2026-08-15T15:00:00.000Z',
                consumedTokens: '42',
            },
        ])

        await expect(
            claimAnalysisConversationTurn({
                userId,
                sessionId,
                generation: 1,
                browserInstanceId,
                contentKind: 'text',
                leaseId,
                leaseDurationSeconds: 210,
            }),
        ).resolves.toMatchObject({ generation: 8, leaseId, consumedTokens: 42 })

        const query = new PgDialect().sqlToQuery(databaseMocks.execute.mock.calls[0]![0])
        expect(query.sql).toMatch(/ON CONFLICT \(user_id\) DO UPDATE/iu)
        expect(query.sql).toMatch(/analysis_conversation_controls\.generation \+ 1/iu)
        expect(query.sql).toMatch(
            /status = 'cleared'[\s\S]*session_id <> excluded\.session_id[\s\S]*THEN excluded\.generation/iu,
        )
        expect(query.sql).toMatch(/lease_expires_at > clock_timestamp\(\)/iu)
        expect(query.sql).toMatch(/make_interval\(secs => \$\d+\)/iu)
        expect(query.sql).toMatch(/status = 'submitted'[\s\S]*session_id <> excluded\.session_id/iu)
        expect(query.sql).toMatch(
            /status = 'cleared'[\s\S]*session_id <> excluded\.session_id[\s\S]*excluded\.generation BETWEEN/iu,
        )
        expect(query.sql).not.toMatch(/message|draft_json|conversation_text/iu)
    })

    it('没有既有控制行时清空仍写入递增代数的 cleared 墓碑', async () => {
        databaseMocks.execute.mockResolvedValueOnce([{ generation: '2' }])

        await expect(
            clearAnalysisConversationControl({
                userId,
                sessionId,
                generation: 1,
                browserInstanceId,
            }),
        ).resolves.toEqual({ cleared: true, generation: 2 })

        const query = new PgDialect().sqlToQuery(databaseMocks.execute.mock.calls[0]![0])
        expect(query.sql).toMatch(/INSERT INTO public\.analysis_conversation_controls/iu)
        expect(query.sql).toMatch(/ON CONFLICT \(user_id\) DO UPDATE/iu)
        expect(query.sql).toMatch(/'cleared'/iu)
        expect(query.params).toContain(2)
    })

    it('未过期处理租约精确报告忙碌，过期后的不匹配请求报告旧会话', async () => {
        databaseMocks.execute.mockResolvedValueOnce([]).mockResolvedValueOnce([
            {
                sessionId,
                generation: 4,
                browserInstanceId,
                status: 'processing',
                contentKind: null,
                leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
            },
        ])
        await expect(
            claimAnalysisConversationTurn({
                userId,
                sessionId,
                generation: 1,
                browserInstanceId,
                contentKind: 'text',
                leaseId,
                leaseDurationSeconds: 210,
            }),
        ).rejects.toBeInstanceOf(AnalysisConversationBusyError)

        databaseMocks.execute.mockResolvedValueOnce([]).mockResolvedValueOnce([
            {
                sessionId,
                generation: 4,
                browserInstanceId,
                status: 'processing',
                contentKind: null,
                leaseExpiresAt: new Date(Date.now() - 60_000).toISOString(),
            },
        ])
        await expect(
            claimAnalysisConversationTurn({
                userId,
                sessionId,
                generation: 1,
                browserInstanceId,
                contentKind: 'text',
                leaseId,
                leaseDurationSeconds: 210,
            }),
        ).rejects.toBeInstanceOf(AnalysisConversationStaleError)
    })

    it('完成、失败释放和手动清空都必须匹配完整身份与租约', async () => {
        databaseMocks.execute.mockResolvedValue([{ userId }])
        await completeAnalysisConversationTurn({
            userId,
            sessionId,
            generation: 4,
            browserInstanceId,
            leaseId,
            contentKind: 'image',
            tokenDelta: 77,
        })
        await releaseAnalysisConversationTurn({
            userId,
            sessionId,
            generation: 4,
            browserInstanceId,
            leaseId,
        })
        await clearAnalysisConversationControl({
            userId,
            sessionId,
            generation: 4,
            browserInstanceId,
        })

        const queries = databaseMocks.execute.mock.calls.map(
            (call) => new PgDialect().sqlToQuery(call[0]).sql,
        )
        for (const query of queries.slice(0, 2)) {
            expect(query).toMatch(/user_id = \$\d+::uuid/iu)
            expect(query).toMatch(/session_id = \$\d+::uuid/iu)
            expect(query).toMatch(/generation = \$\d+/iu)
            expect(query).toMatch(/browser_instance_id = \$\d+::uuid/iu)
        }
        expect(queries[0]).toMatch(/lease_id = \$\d+::uuid/iu)
        expect(queries[0]).toMatch(/consumed_tokens = consumed_tokens \+ \$\d+/iu)
        expect(queries[1]).toMatch(/lease_id = \$\d+::uuid/iu)
        expect(queries[2]).toMatch(/INSERT INTO public\.analysis_conversation_controls/iu)
        expect(queries[2]).toMatch(/generation = analysis_conversation_controls\.generation \+ 1/iu)
        expect(queries[2]).toMatch(/status = 'cleared'/iu)
        expect(queries[2]).not.toMatch(/lease_expires_at > clock_timestamp\(\)/iu)
    })

    it('只读权威快照包含已结算会话 Token，不包含任何聊天正文', async () => {
        databaseMocks.execute.mockResolvedValueOnce([
            {
                sessionId,
                generation: 4,
                browserInstanceId,
                status: 'active',
                contentKind: 'text',
                leaseExpiresAt: null,
                consumedTokens: '1234',
            },
        ])

        await expect(getAnalysisConversationControl(userId)).resolves.toMatchObject({
            consumedTokens: 1234,
        })
    })

    it('正式任务受理后递增代数并原子清零会话预算', async () => {
        databaseMocks.execute.mockResolvedValueOnce([{ generation: '5' }])

        await expect(resetAnalysisConversationAfterTaskAdmission(userId)).resolves.toBe(true)

        const query = new PgDialect().sqlToQuery(databaseMocks.execute.mock.calls[0]![0])
        expect(query.sql).toMatch(/ELSE generation \+ 1 END/iu)
        expect(query.sql).toMatch(/consumed_tokens = 0/iu)
        expect(query.sql).toMatch(/ELSE 'submitted' END/iu)
    })

    it('Plus 正式受理只关闭请求携带的精确会话身份', async () => {
        databaseMocks.execute.mockResolvedValueOnce([{ generation: '5' }])

        await expect(
            submitAnalysisConversationAfterTaskAdmission({
                userId,
                sessionId,
                generation: 4,
                browserInstanceId,
            }),
        ).resolves.toBe(true)

        const query = new PgDialect().sqlToQuery(databaseMocks.execute.mock.calls[0]![0])
        expect(query.sql).toMatch(/generation = generation \+ 1/iu)
        expect(query.sql).toMatch(/status = 'submitted'/iu)
        expect(query.sql).toMatch(/consumed_tokens = 0/iu)
        expect(query.sql).toMatch(/session_id = \$\d+::uuid/iu)
        expect(query.sql).toMatch(/generation = \$\d+/iu)
        expect(query.sql).toMatch(/browser_instance_id = \$\d+::uuid/iu)
        expect(query.sql).toMatch(/status <> 'processing'/iu)
        expect(query.sql).toMatch(
            /NOT EXISTS[\s\S]*analysis_conversation_turn_runs[\s\S]*status IN \('processing', 'completed'\)/iu,
        )
        expect(query.sql).not.toMatch(/INSERT/iu)
    })
})
