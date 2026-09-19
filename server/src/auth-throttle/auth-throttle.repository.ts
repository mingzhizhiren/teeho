import { sql } from 'drizzle-orm'

import { db } from '../db/database'
import type { AuthThrottleScope } from './auth-throttle.constants'

export interface AuthThrottleKey {
    scope: AuthThrottleScope
    keyHash: string
}

export interface AuthThrottleFailureKey extends AuthThrottleKey {
    attemptLimit: number
}

interface BlockedRow extends Record<string, unknown> {
    blocked: boolean
}

interface FailureRow extends Record<string, unknown> {
    locked: boolean
}

function throttleValues(keys: readonly AuthThrottleKey[]) {
    return sql.join(
        keys.map((key) => sql`(${key.scope}, ${key.keyHash})`),
        sql`, `,
    )
}

/** 检查任一聚合键是否仍处于锁定期；只读检查不会延长限制。 */
export async function hasActiveLoginThrottle(keys: readonly AuthThrottleKey[]) {
    if (keys.length === 0) return false

    const rows = await db.execute<BlockedRow>(sql`
        SELECT EXISTS (
            SELECT 1
            FROM public.auth_login_throttles AS throttle
            INNER JOIN (VALUES ${throttleValues(keys)}) AS requested(scope, key_hash)
                ON requested.scope = throttle.scope
                AND requested.key_hash = throttle.key_hash
            WHERE throttle.locked_until > now()
        ) AS blocked
    `)
    return rows[0]?.blocked === true
}

/** 原子累计一次失败；并发请求共享表内唯一键，不会丢失计数。 */
export async function recordLoginThrottleFailure(
    keys: readonly AuthThrottleFailureKey[],
    observationWindowMs: number,
    lockDurationMs: number,
) {
    if (keys.length === 0) return false

    const values = sql.join(
        keys.map(
            (key) => sql`(
                ${key.scope},
                ${key.keyHash},
                ${key.attemptLimit},
                ${observationWindowMs},
                ${lockDurationMs}
            )`,
        ),
        sql`, `,
    )
    const rows = await db.execute<FailureRow>(sql`
        WITH requested(scope, key_hash, attempt_limit, window_ms, lock_ms) AS (
            VALUES ${values}
        ),
        recorded AS (
            INSERT INTO public.auth_login_throttles (
                scope,
                key_hash,
                failed_count,
                attempt_limit,
                observation_window_ms,
                lock_duration_ms,
                window_started_at,
                locked_until,
                updated_at
            )
            SELECT scope, key_hash, 1, attempt_limit, window_ms, lock_ms, now(), NULL, now()
            FROM requested
            ON CONFLICT (scope, key_hash) DO UPDATE SET
                failed_count = CASE
                    WHEN public.auth_login_throttles.window_started_at
                        <= now() - make_interval(
                            secs => EXCLUDED.observation_window_ms / 1000.0
                        )
                        THEN 1
                    ELSE public.auth_login_throttles.failed_count + 1
                END,
                attempt_limit = EXCLUDED.attempt_limit,
                observation_window_ms = EXCLUDED.observation_window_ms,
                lock_duration_ms = EXCLUDED.lock_duration_ms,
                window_started_at = CASE
                    WHEN public.auth_login_throttles.window_started_at
                        <= now() - make_interval(
                            secs => EXCLUDED.observation_window_ms / 1000.0
                        )
                        THEN now()
                    ELSE public.auth_login_throttles.window_started_at
                END,
                locked_until = CASE
                    WHEN (
                        CASE
                            WHEN public.auth_login_throttles.window_started_at
                                <= now() - make_interval(
                                    secs => EXCLUDED.observation_window_ms / 1000.0
                                )
                                THEN 1
                            ELSE public.auth_login_throttles.failed_count + 1
                        END
                    ) >= EXCLUDED.attempt_limit
                        THEN now() + make_interval(
                            secs => EXCLUDED.lock_duration_ms / 1000.0
                        )
                    ELSE NULL
                END,
                updated_at = now()
            WHERE
                public.auth_login_throttles.locked_until IS NULL
                OR public.auth_login_throttles.locked_until <= now()
            RETURNING locked_until IS NOT NULL AND locked_until > now() AS locked
        )
        SELECT locked
        FROM recorded
    `)
    return rows.length < keys.length || rows.some((row) => row.locked === true)
}

/** 登录成功后移除当前账号标识的失败窗口。 */
export async function clearLoginThrottle(key: AuthThrottleKey) {
    await db.execute(sql`
        DELETE FROM public.auth_login_throttles
        WHERE scope = ${key.scope} AND key_hash = ${key.keyHash}
    `)
}
