import { PGlite } from '@electric-sql/pglite'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { expect, it, vi } from 'vitest'
import type { DatabaseExecutor } from '../../db/database'

vi.mock('../../db/database', () => ({ db: {} }))

import {
    AnalysisConversationBusyError,
    AnalysisConversationStaleError,
    claimAnalysisConversationTurn,
    completeAnalysisConversationTurn,
    getAnalysisConversationControl,
} from './analysis.conversation.repository'

it('已聊天会话拒绝切换形态，同形态继续累计预算且阻止并发', async () => {
    const database = new PGlite()
    const executor = {
        async execute(statement: SQL) {
            const query = new PgDialect().sqlToQuery(statement)
            return (await database.query(query.sql, query.params)).rows
        },
    } as unknown as DatabaseExecutor
    const identity = {
        userId: '00000000-0000-4000-8000-000000000001',
        sessionId: '00000000-0000-4000-8000-000000000002',
        browserInstanceId: '00000000-0000-4000-8000-000000000003',
        generation: 1,
        leaseId: '00000000-0000-4000-8000-000000000004',
    }
    try {
        await database.exec(`CREATE TABLE analysis_conversation_controls (
            user_id uuid PRIMARY KEY, session_id uuid, generation integer,
            browser_instance_id uuid, content_kind text, status text,
            consumed_tokens integer DEFAULT 0, lease_id uuid, lease_expires_at timestamptz,
            last_activity_at timestamptz, updated_at timestamptz DEFAULT now()
        )`)
        let consumed = 0
        for (const contentKind of ['image', 'image'] as const) {
            const claim = await claimAnalysisConversationTurn(
                {
                    ...identity,
                    contentKind,
                    leaseDurationSeconds: 60,
                },
                executor,
            )
            expect(claim.consumedTokens).toBe(consumed)
            await expect(
                claimAnalysisConversationTurn(
                    {
                        ...identity,
                        contentKind,
                        leaseDurationSeconds: 60,
                    },
                    executor,
                ),
            ).rejects.toBeInstanceOf(AnalysisConversationBusyError)
            consumed += 100
            expect(
                await completeAnalysisConversationTurn(
                    {
                        ...identity,
                        contentKind,
                        tokenDelta: 100,
                    },
                    executor,
                ),
            ).toEqual({ completed: true, consumedTokens: consumed })
            expect(await getAnalysisConversationControl(identity.userId, executor)).toMatchObject({
                contentKind,
                generation: 1,
                consumedTokens: consumed,
                status: 'active',
            })
            await expect(
                claimAnalysisConversationTurn(
                    {
                        ...identity,
                        contentKind: 'video',
                        leaseDurationSeconds: 60,
                    },
                    executor,
                ),
            ).rejects.toBeInstanceOf(AnalysisConversationStaleError)
        }
    } finally {
        await database.close()
    }
})
