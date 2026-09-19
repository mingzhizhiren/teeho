import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'

import {
    acknowledgeAnalysisConversationTurnRun,
    beginAnalysisConversationTurnRun,
    blockAnalysisConversationAuthSession,
    completeAnalysisConversationTurnRun,
    invalidateAnalysisConversationTurnRuns,
    isAnalysisConversationAuthSessionBlocked,
    renewAnalysisConversationTurnRun,
} from './analysis.conversation-turn-run.repository'

const userId = '00000000-0000-4000-8000-000000000001'
const turnId = '00000000-0000-4000-8000-000000000002'
const session = {
    sessionId: '00000000-0000-4000-8000-000000000003',
    generation: 2,
    browserInstanceId: '00000000-0000-4000-8000-000000000004',
}

function queryAt(execute: ReturnType<typeof vi.fn>, index: number) {
    return new PgDialect().sqlToQuery(execute.mock.calls[index]![0])
}

describe('analysis conversation turn run repository', () => {
    it('stores only the verified auth-session key and blocks the same logged-out session', async () => {
        const authSessionKey = 'session:00000000-0000-4000-8000-000000000099'
        const execute = vi
            .fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ blocked: true }])

        await blockAnalysisConversationAuthSession({ execute } as never, userId, authSessionKey)
        await expect(
            isAnalysisConversationAuthSessionBlocked({ execute } as never, userId, authSessionKey),
        ).resolves.toBe(true)

        const block = queryAt(execute, 0)
        const inspect = queryAt(execute, 1)
        expect(block.sql).toMatch(/analysis_conversation_logout_sessions/iu)
        expect(block.sql).toMatch(/ON CONFLICT \(user_id, auth_session_key\)/iu)
        expect(inspect.sql).toMatch(/expires_at > clock_timestamp\(\)/iu)
        expect(block.params).toContain(authSessionKey)
        expect(block.sql).not.toMatch(/access_token|refresh_token/iu)
    })

    it('creates one processing run without storing request text', async () => {
        const execute = vi
            .fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ id: turnId }])
            .mockResolvedValueOnce([
                {
                    id: turnId,
                    userId,
                    ...session,
                    status: 'processing',
                    resultPayload: null,
                    failureReason: null,
                    processingExpiresAt: '2026-08-27T13:03:30.000Z',
                },
            ])

        await expect(
            beginAnalysisConversationTurnRun({ execute } as never, { userId, turnId, ...session }),
        ).resolves.toMatchObject({ status: 'processing', created: true })

        const insert = queryAt(execute, 1)
        expect(insert.sql).toMatch(/INSERT INTO public\.analysis_conversation_turn_runs/iu)
        expect(insert.sql).not.toMatch(/message|history|draft/iu)
        expect(insert.params).toEqual(expect.arrayContaining([turnId, userId]))
    })

    it('acknowledges only the exact completed same-browser result and removes payload', async () => {
        const execute = vi.fn().mockResolvedValueOnce([{ id: turnId }])

        await expect(
            acknowledgeAnalysisConversationTurnRun({ execute } as never, {
                userId,
                turnId,
                ...session,
            }),
        ).resolves.toBe(true)

        const query = queryAt(execute, 0)
        expect(query.sql).toMatch(/status = 'acknowledged'/iu)
        expect(query.sql).toMatch(/result_payload = NULL/iu)
        expect(query.sql).toMatch(/browser_instance_id/iu)
    })

    it('renews the exact live processing run when the authority lease is claimed', async () => {
        const execute = vi.fn().mockResolvedValueOnce([{ id: turnId }])

        await expect(
            renewAnalysisConversationTurnRun({ execute } as never, { userId, turnId, ...session }),
        ).resolves.toBe(true)

        const query = queryAt(execute, 0)
        expect(query.sql).toMatch(/SET processing_expires_at = LEAST\(/iu)
        expect(query.sql).toMatch(/status = 'processing'/iu)
        expect(query.sql).toMatch(/processing_expires_at > clock_timestamp\(\)/iu)
        expect(query.params).toEqual(expect.arrayContaining([turnId, userId]))
    })

    it('serializes a completed structured result before binding it as jsonb', async () => {
        const execute = vi.fn().mockResolvedValueOnce([{ id: turnId }])
        const result = {
            schemaVersion: 'analysis-conversation-turn-result.v1',
            action: 'draft_ready',
        } as never

        await expect(
            completeAnalysisConversationTurnRun(
                { execute } as never,
                { userId, turnId, ...session },
                result,
            ),
        ).resolves.toBe(true)

        const query = queryAt(execute, 0)
        expect(query.params[0]).toBe(JSON.stringify(result))
    })

    it('clear or logout invalidates processing and completed results', async () => {
        const execute = vi.fn().mockResolvedValue([{ id: turnId }])

        await invalidateAnalysisConversationTurnRuns({ execute } as never, {
            userId,
            reason: 'logged_out',
        })

        const query = queryAt(execute, 0)
        expect(query.sql).toMatch(/status IN \('processing', 'completed'\)/iu)
        expect(query.params).toContain('logged_out')
        expect(query.params).toContain(userId)
    })
})
