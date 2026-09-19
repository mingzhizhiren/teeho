import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'

import {
    commitAnalysisDraftSendReservation,
    insertAnalysisDraftSendReservation,
    lockAnalysisDraftSendWindow,
    releaseAnalysisDraftSendReservation,
} from './analysis.draft-send-window.repository'

const userId = '00000000-0000-4000-8000-000000000001'
const reservationId = '00000000-0000-4000-8000-000000000002'

function queryText(call: unknown[]) {
    return new PgDialect().sqlToQuery(call[0] as never).sql
}

describe('analysis draft send window repository', () => {
    it('提交占位必须命中仍为 reserved 的记录并返回事务可判定结果', async () => {
        const execute = vi
            .fn()
            .mockResolvedValueOnce([{ id: reservationId }])
            .mockResolvedValueOnce([])
        const transaction = { execute } as never

        await expect(
            commitAnalysisDraftSendReservation(transaction, userId, reservationId),
        ).resolves.toBe(true)
        await expect(
            commitAnalysisDraftSendReservation(transaction, userId, reservationId),
        ).resolves.toBe(false)

        expect(queryText(execute.mock.calls[0]!)).toMatch(
            /AND state = 'reserved'[\s\S]*RETURNING id/iu,
        )
    })

    it('并发占位先锁定账号窗口行，再在同一事务执行占位和计数递增', async () => {
        const execute = vi
            .fn()
            .mockResolvedValueOnce([
                {
                    windowStartedAt: '2026-08-15T00:00:00.000Z',
                    acceptedCount: '4',
                    databaseNow: '2026-08-15T00:01:00.000Z',
                },
            ])
            .mockResolvedValue([])
        const transaction = { execute } as never

        await expect(lockAnalysisDraftSendWindow(transaction, userId)).resolves.toMatchObject({
            acceptedCount: 4,
        })
        await insertAnalysisDraftSendReservation(transaction, { userId, reservationId })

        expect(queryText(execute.mock.calls[0]!)).toMatch(/FOR UPDATE/iu)
        expect(queryText(execute.mock.calls[1]!)).toMatch(
            /INSERT INTO public\.analysis_draft_send_reservations/iu,
        )
        expect(queryText(execute.mock.calls[2]!)).toMatch(/accepted_count = accepted_count \+ 1/iu)
    })

    it('技术失败只在首次把 reserved 改为 released 时回退一次计数', async () => {
        const execute = vi
            .fn()
            .mockResolvedValueOnce([{ windowStartedAt: '2026-08-15T00:00:00.000Z' }])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
        const transaction = { execute } as never

        await releaseAnalysisDraftSendReservation(transaction, userId, reservationId)
        await releaseAnalysisDraftSendReservation(transaction, userId, reservationId)

        expect(queryText(execute.mock.calls[0]!)).toMatch(/AND state = 'reserved'/iu)
        expect(queryText(execute.mock.calls[1]!)).toMatch(
            /accepted_count = greatest\(accepted_count - 1, 0\)/iu,
        )
        expect(execute).toHaveBeenCalledTimes(3)
    })
})
