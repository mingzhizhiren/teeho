import { sql } from 'drizzle-orm'

import type { DatabaseExecutor } from '../../db/database'

/** 任务草稿发送窗口记录。 */
export interface AnalysisDraftSendWindowRecord {
    windowStartedAt: string
    acceptedCount: number
    databaseNow: string
}

/** 确保账号拥有一条可锁定的草稿发送窗口。 */
export async function ensureAnalysisDraftSendWindow(executor: DatabaseExecutor, userId: string) {
    await executor.execute(sql`
        INSERT INTO public.analysis_draft_send_windows (
            user_id,
            window_started_at,
            accepted_count
        )
        VALUES (${userId}::uuid, clock_timestamp(), 0)
        ON CONFLICT (user_id) DO NOTHING
    `)
}

/** 锁定并读取账号当前窗口以及同一数据库时钟。 */
export async function lockAnalysisDraftSendWindow(
    executor: DatabaseExecutor,
    userId: string,
): Promise<AnalysisDraftSendWindowRecord> {
    const rows = await executor.execute<{
        windowStartedAt: Date | string
        acceptedCount: number | string
        databaseNow: Date | string
    }>(sql`
        SELECT
            window_started_at AS "windowStartedAt",
            accepted_count AS "acceptedCount",
            clock_timestamp() AS "databaseNow"
        FROM public.analysis_draft_send_windows
        WHERE user_id = ${userId}::uuid
        FOR UPDATE
    `)
    const row = rows[0]
    if (!row) {
        throw new Error('草稿发送窗口初始化后无法读取')
    }
    return {
        windowStartedAt: new Date(row.windowStartedAt).toISOString(),
        acceptedCount: Number(row.acceptedCount),
        databaseNow: new Date(row.databaseNow).toISOString(),
    }
}

/** 在已持有账号窗口锁时开始一个新固定窗口。 */
export async function resetAnalysisDraftSendWindow(
    executor: DatabaseExecutor,
    userId: string,
    windowStartedAt: string,
) {
    await executor.execute(sql`
        DELETE FROM public.analysis_draft_send_reservations
        WHERE user_id = ${userId}::uuid
    `)
    await executor.execute(sql`
        UPDATE public.analysis_draft_send_windows
        SET
            window_started_at = ${windowStartedAt}::timestamptz,
            accepted_count = 0,
            updated_at = clock_timestamp()
        WHERE user_id = ${userId}::uuid
    `)
}

/** 在已持有窗口锁时插入一次发送占位并增加计数。 */
export async function insertAnalysisDraftSendReservation(
    executor: DatabaseExecutor,
    param: {
        reservationId: string
        userId: string
    },
) {
    await executor.execute(sql`
        INSERT INTO public.analysis_draft_send_reservations (
            id,
            user_id,
            window_started_at,
            state
        )
        SELECT
            ${param.reservationId}::uuid,
            user_id,
            window_started_at,
            'reserved'
        FROM public.analysis_draft_send_windows
        WHERE user_id = ${param.userId}::uuid
    `)
    await executor.execute(sql`
        UPDATE public.analysis_draft_send_windows
        SET
            accepted_count = accepted_count + 1,
            updated_at = clock_timestamp()
        WHERE user_id = ${param.userId}::uuid
    `)
}

/** 将一次成功得到语义结果的发送占位提交为已计数。 */
export async function commitAnalysisDraftSendReservation(
    executor: DatabaseExecutor,
    userId: string,
    reservationId: string,
) {
    const rows = await executor.execute<{ id: string }>(sql`
        UPDATE public.analysis_draft_send_reservations
        SET state = 'committed', updated_at = clock_timestamp()
        WHERE id = ${reservationId}::uuid
            AND user_id = ${userId}::uuid
            AND state = 'reserved'
        RETURNING id
    `)
    return Boolean(rows[0])
}

/** 释放一次技术失败的发送占位并仅在首次释放时回退计数。 */
export async function releaseAnalysisDraftSendReservation(
    executor: DatabaseExecutor,
    userId: string,
    reservationId: string,
) {
    const released = await executor.execute<{ windowStartedAt: Date | string }>(sql`
        UPDATE public.analysis_draft_send_reservations
        SET state = 'released', updated_at = clock_timestamp()
        WHERE id = ${reservationId}::uuid
            AND user_id = ${userId}::uuid
            AND state = 'reserved'
        RETURNING window_started_at AS "windowStartedAt"
    `)
    if (!released[0]?.windowStartedAt) {
        return
    }
    await executor.execute(sql`
        UPDATE public.analysis_draft_send_windows
        SET
            accepted_count = greatest(accepted_count - 1, 0),
            updated_at = clock_timestamp()
        WHERE user_id = ${userId}::uuid
    `)
}

/** 成功创建正式任务后清除账号当前草稿发送窗口。 */
export async function clearAnalysisDraftSendWindow(executor: DatabaseExecutor, userId: string) {
    await executor.execute(sql`
        DELETE FROM public.analysis_draft_send_windows
        WHERE user_id = ${userId}::uuid
    `)
}
