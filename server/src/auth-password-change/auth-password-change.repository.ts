import { sql } from 'drizzle-orm'

import { db } from '../db/database'
import type { PasswordChangeThrottleScope } from './auth-password-change.constants'

export interface PasswordChangeThrottleKey {
    scope: PasswordChangeThrottleScope
    keyHash: string
}

export interface PasswordChangeFailureKey extends PasswordChangeThrottleKey {
    attemptLimit: number
}

interface BlockedRow extends Record<string, unknown> {
    blocked: boolean
}

interface LimitedRow extends Record<string, unknown> {
    limited: boolean
}

function throttleValues(keys: readonly PasswordChangeThrottleKey[]) {
    return sql.join(
        keys.map((key) => sql`(${key.scope}, ${key.keyHash})`),
        sql`, `,
    )
}

/** 只读检查账号或 IP 是否仍在密码修改失败窗口内。 */
export async function hasActivePasswordChangeThrottle(
    keys: readonly PasswordChangeThrottleKey[],
): Promise<boolean> {
    if (keys.length === 0) return false

    const rows = await db.execute<BlockedRow>(sql`
        SELECT EXISTS (
            SELECT 1
            FROM public.auth_password_change_throttles AS throttle
            INNER JOIN (VALUES ${throttleValues(keys)}) AS requested(scope, key_hash)
                ON requested.scope = throttle.scope
                AND requested.key_hash = throttle.key_hash
            WHERE throttle.blocked_until > clock_timestamp()
        ) AS blocked
    `)
    return rows[0]?.blocked === true
}

/** 原子累计一次确定的当前密码错误，达到任一阈值后限制到当前观察窗口结束。 */
export async function recordPasswordChangeFailure(
    keys: readonly PasswordChangeFailureKey[],
    observationWindowMs: number,
): Promise<boolean> {
    if (keys.length === 0) return false

    const values = sql.join(
        keys.map(
            (key) => sql`(
                ${key.scope}::text,
                ${key.keyHash}::text,
                ${key.attemptLimit}::integer,
                ${observationWindowMs}::integer
            )`,
        ),
        sql`, `,
    )
    const rows = await db.execute<LimitedRow>(sql`
        WITH requested(scope, key_hash, attempt_limit, window_ms) AS (
            VALUES ${values}
        ),
        recorded AS (
            INSERT INTO public.auth_password_change_throttles (
                scope,
                key_hash,
                failed_count,
                attempt_limit,
                observation_window_ms,
                window_started_at,
                blocked_until,
                updated_at
            )
            SELECT
                scope,
                key_hash,
                1,
                attempt_limit,
                window_ms,
                clock_timestamp(),
                CASE
                    WHEN attempt_limit <= 1
                        THEN clock_timestamp() + (window_ms * interval '1 millisecond')
                    ELSE NULL
                END,
                clock_timestamp()
            FROM requested
            ON CONFLICT (scope, key_hash) DO UPDATE SET
                failed_count = CASE
                    WHEN public.auth_password_change_throttles.window_started_at
                        <= clock_timestamp()
                            - (EXCLUDED.observation_window_ms * interval '1 millisecond')
                        THEN 1
                    ELSE public.auth_password_change_throttles.failed_count + 1
                END,
                attempt_limit = EXCLUDED.attempt_limit,
                observation_window_ms = EXCLUDED.observation_window_ms,
                window_started_at = CASE
                    WHEN public.auth_password_change_throttles.window_started_at
                        <= clock_timestamp()
                            - (EXCLUDED.observation_window_ms * interval '1 millisecond')
                        THEN clock_timestamp()
                    ELSE public.auth_password_change_throttles.window_started_at
                END,
                blocked_until = CASE
                    WHEN (
                        CASE
                            WHEN public.auth_password_change_throttles.window_started_at
                                <= clock_timestamp()
                                    - (
                                        EXCLUDED.observation_window_ms
                                        * interval '1 millisecond'
                                    )
                                THEN 1
                            ELSE public.auth_password_change_throttles.failed_count + 1
                        END
                    ) >= EXCLUDED.attempt_limit
                        THEN (
                            CASE
                                WHEN public.auth_password_change_throttles.window_started_at
                                    <= clock_timestamp()
                                        - (
                                            EXCLUDED.observation_window_ms
                                            * interval '1 millisecond'
                                        )
                                    THEN clock_timestamp()
                                ELSE public.auth_password_change_throttles.window_started_at
                            END
                        ) + (EXCLUDED.observation_window_ms * interval '1 millisecond')
                    ELSE NULL
                END,
                updated_at = clock_timestamp()
            WHERE
                public.auth_password_change_throttles.blocked_until IS NULL
                OR public.auth_password_change_throttles.blocked_until <= clock_timestamp()
            RETURNING blocked_until IS NOT NULL
                AND blocked_until > clock_timestamp() AS limited
        )
        SELECT limited
        FROM recorded
    `)

    return rows.length < keys.length || rows.some((row) => row.limited === true)
}
