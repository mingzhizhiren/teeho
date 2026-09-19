import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'

import { readAnalysisRollingUsage } from './analysis.rolling-usage.repository'

describe('analysis rolling usage repository', () => {
    it('只读取任务形成阶段，并以滚动窗口和升级水位中较晚者作为统计起点', async () => {
        const execute = vi.fn().mockResolvedValueOnce([
            {
                startedAt: '2026-08-15T10:00:00.000Z',
                tokenCount: '123',
                databaseNow: '2026-08-15T12:00:00.000Z',
            },
        ])

        await expect(
            readAnalysisRollingUsage({ execute } as never, 'user-1', 86_400),
        ).resolves.toEqual({
            databaseNow: '2026-08-15T12:00:00.000Z',
            calls: [{ startedAt: '2026-08-15T10:00:00.000Z', tokenCount: 123 }],
        })

        const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0])
        expect(query.sql).toMatch(/stage = 'form_conversation_turn'/iu)
        expect(query.sql).toMatch(/metered_tokens > 0/iu)
        expect(query.sql).toMatch(/greatest[\s\S]*rolling_usage_reset_at/iu)
        expect(query.sql).not.toMatch(
            /score_missing_signals|generate_result|collect_web_research/iu,
        )
    })
})
