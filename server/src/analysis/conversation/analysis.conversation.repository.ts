import { sql } from 'drizzle-orm'

import { db, type DatabaseExecutor } from '../../db/database'

export type AnalysisConversationContentKind = 'text' | 'image' | 'video'
export type AnalysisConversationStatus =
    | 'active'
    | 'processing'
    | 'finalized'
    | 'submitted'
    | 'cleared'

export interface AnalysisConversationSessionIdentity {
    sessionId: string
    generation: number
    browserInstanceId: string
}

export interface AnalysisConversationTurnClaimInput extends AnalysisConversationSessionIdentity {
    userId: string
    contentKind: AnalysisConversationContentKind
    leaseId: string
    leaseDurationSeconds: number
}

export interface AnalysisConversationLeaseIdentity extends AnalysisConversationSessionIdentity {
    userId: string
    leaseId: string
}

export interface AnalysisConversationTurnCompletionInput extends AnalysisConversationLeaseIdentity {
    contentKind: AnalysisConversationContentKind
    tokenDelta: number
}

export interface AnalysisConversationControlSnapshot extends AnalysisConversationSessionIdentity {
    status: AnalysisConversationStatus
    contentKind: AnalysisConversationContentKind | null
    leaseExpiresAt: string | null
    consumedTokens: number
}

export interface AnalysisConversationTurnClaim extends AnalysisConversationSessionIdentity {
    leaseId: string
    takenOver: boolean
    consumedTokens: number
}

export class AnalysisConversationBusyError extends Error {
    constructor(message = 'Agent 正在另一个页面处理消息，请稍后再试。') {
        super(message)
        this.name = 'AnalysisConversationBusyError'
    }
}

export class AnalysisConversationStaleError extends Error {
    constructor(message = '当前会话已在另一个页面开始。') {
        super(message)
        this.name = 'AnalysisConversationStaleError'
    }
}

interface AnalysisConversationControlRow extends Record<string, unknown> {
    sessionId: string
    generation: number | string
    browserInstanceId: string
    status: AnalysisConversationStatus
    contentKind: AnalysisConversationContentKind | null
    leaseExpiresAt: Date | string | null
    consumedTokens: number | string
}

function snapshotFromRow(row: AnalysisConversationControlRow): AnalysisConversationControlSnapshot {
    return {
        sessionId: row.sessionId,
        generation: Number(row.generation),
        browserInstanceId: row.browserInstanceId,
        status: row.status,
        contentKind: row.contentKind,
        leaseExpiresAt:
            row.leaseExpiresAt instanceof Date
                ? row.leaseExpiresAt.toISOString()
                : row.leaseExpiresAt,
        consumedTokens: Number(row.consumedTokens),
    }
}

/** Read account authority without creating or taking over a conversation. */
export async function getAnalysisConversationControl(
    userId: string,
    executor: DatabaseExecutor = db,
) {
    const rows = await executor.execute<AnalysisConversationControlRow>(sql`
        SELECT
            session_id AS "sessionId",
            generation,
            browser_instance_id AS "browserInstanceId",
            status,
            content_kind AS "contentKind",
            lease_expires_at AS "leaseExpiresAt",
            consumed_tokens AS "consumedTokens"
        FROM public.analysis_conversation_controls
        WHERE user_id = ${userId}::uuid
            AND status <> 'idle'
        LIMIT 1
    `)
    return rows[0] ? snapshotFromRow(rows[0]) : null
}

/**
 * Atomically owns one provider turn. A different browser only takes authority when
 * it sends a valid turn and no unexpired provider lease exists.
 */
export async function claimAnalysisConversationTurn(
    input: AnalysisConversationTurnClaimInput,
    executor: DatabaseExecutor = db,
): Promise<AnalysisConversationTurnClaim> {
    const rows = await executor.execute<AnalysisConversationControlRow & { leaseId: string }>(sql`
        INSERT INTO public.analysis_conversation_controls (
            user_id,
            session_id,
            generation,
            browser_instance_id,
            status,
            lease_id,
            lease_expires_at,
            last_activity_at
        )
        VALUES (
            ${input.userId}::uuid,
            ${input.sessionId}::uuid,
            ${input.generation},
            ${input.browserInstanceId}::uuid,
            'processing',
            ${input.leaseId}::uuid,
            clock_timestamp() + make_interval(secs => ${input.leaseDurationSeconds}),
            clock_timestamp()
        )
        ON CONFLICT (user_id) DO UPDATE
        SET
            session_id = excluded.session_id,
            generation = CASE
                WHEN analysis_conversation_controls.status = 'idle'
                    THEN excluded.generation
                WHEN analysis_conversation_controls.status = 'cleared'
                    AND analysis_conversation_controls.browser_instance_id = excluded.browser_instance_id
                    AND analysis_conversation_controls.session_id <> excluded.session_id
                    THEN excluded.generation
                WHEN analysis_conversation_controls.browser_instance_id = excluded.browser_instance_id
                    AND analysis_conversation_controls.session_id = excluded.session_id
                    THEN analysis_conversation_controls.generation
                ELSE analysis_conversation_controls.generation + 1
            END,
            browser_instance_id = excluded.browser_instance_id,
            content_kind = CASE
                WHEN analysis_conversation_controls.browser_instance_id = excluded.browser_instance_id
                    AND analysis_conversation_controls.session_id = excluded.session_id
                    THEN analysis_conversation_controls.content_kind
                ELSE NULL
            END,
            consumed_tokens = CASE
                WHEN analysis_conversation_controls.browser_instance_id = excluded.browser_instance_id
                    AND analysis_conversation_controls.session_id = excluded.session_id
                    THEN analysis_conversation_controls.consumed_tokens
                ELSE 0
            END,
            status = 'processing',
            lease_id = excluded.lease_id,
            lease_expires_at = excluded.lease_expires_at,
            last_activity_at = clock_timestamp(),
            updated_at = clock_timestamp()
        WHERE NOT (
                analysis_conversation_controls.status = 'processing'
                AND analysis_conversation_controls.lease_expires_at > clock_timestamp()
            )
            AND (
                (
                    analysis_conversation_controls.browser_instance_id = excluded.browser_instance_id
                    AND analysis_conversation_controls.session_id = excluded.session_id
                    AND excluded.generation = analysis_conversation_controls.generation
                    AND (
                        analysis_conversation_controls.content_kind IS NULL
                        OR analysis_conversation_controls.content_kind = ${input.contentKind}
                    )
                )
                OR (
                    analysis_conversation_controls.browser_instance_id = excluded.browser_instance_id
                    AND analysis_conversation_controls.session_id <> excluded.session_id
                    AND excluded.generation = analysis_conversation_controls.generation + 1
                )
                OR analysis_conversation_controls.browser_instance_id <> excluded.browser_instance_id
                OR (
                    analysis_conversation_controls.status = 'submitted'
                    AND analysis_conversation_controls.session_id <> excluded.session_id
                )
                OR analysis_conversation_controls.status = 'idle'
                OR (
                    analysis_conversation_controls.status = 'cleared'
                    AND analysis_conversation_controls.browser_instance_id = excluded.browser_instance_id
                    AND analysis_conversation_controls.session_id <> excluded.session_id
                    AND excluded.generation BETWEEN analysis_conversation_controls.generation
                        AND analysis_conversation_controls.generation + 1
                )
            )
        RETURNING
            session_id AS "sessionId",
            generation,
            browser_instance_id AS "browserInstanceId",
            status,
            content_kind AS "contentKind",
            lease_id AS "leaseId",
            lease_expires_at AS "leaseExpiresAt",
            consumed_tokens AS "consumedTokens"
    `)
    const row = rows[0]
    if (!row) {
        const current = await getAnalysisConversationControl(input.userId, executor)
        if (
            current?.status === 'processing' &&
            current.leaseExpiresAt &&
            new Date(current.leaseExpiresAt).getTime() > Date.now()
        ) {
            throw new AnalysisConversationBusyError()
        }
        throw new AnalysisConversationStaleError()
    }

    const snapshot = snapshotFromRow(row)
    return {
        sessionId: snapshot.sessionId,
        generation: snapshot.generation,
        browserInstanceId: snapshot.browserInstanceId,
        leaseId: row.leaseId,
        takenOver:
            snapshot.sessionId !== input.sessionId ||
            snapshot.generation !== input.generation ||
            snapshot.browserInstanceId !== input.browserInstanceId,
        consumedTokens: Number(row.consumedTokens),
    }
}

/** Finish only the exact lease that produced the accepted Agent result. */
export async function completeAnalysisConversationTurn(
    input: AnalysisConversationTurnCompletionInput,
    executor: DatabaseExecutor = db,
) {
    const rows = await executor.execute<{ consumedTokens: number | string }>(sql`
        UPDATE public.analysis_conversation_controls
        SET
            content_kind = ${input.contentKind},
            consumed_tokens = consumed_tokens + ${input.tokenDelta},
            status = 'active',
            lease_id = NULL,
            lease_expires_at = NULL,
            last_activity_at = clock_timestamp(),
            updated_at = clock_timestamp()
        WHERE user_id = ${input.userId}::uuid
            AND session_id = ${input.sessionId}::uuid
            AND generation = ${input.generation}
            AND browser_instance_id = ${input.browserInstanceId}::uuid
            AND lease_id = ${input.leaseId}::uuid
            AND status = 'processing'
            AND (content_kind IS NULL OR content_kind = ${input.contentKind})
        RETURNING consumed_tokens AS "consumedTokens"
    `)
    const row = rows[0]
    return row
        ? { completed: true as const, consumedTokens: Number(row.consumedTokens) }
        : { completed: false as const, consumedTokens: null }
}

/** Release a failed/disconnected turn without changing the winning identity. */
export async function releaseAnalysisConversationTurn(
    input: AnalysisConversationLeaseIdentity,
    executor: DatabaseExecutor = db,
) {
    const rows = await executor.execute<{ userId: string }>(sql`
        UPDATE public.analysis_conversation_controls
        SET
            status = 'active',
            lease_id = NULL,
            lease_expires_at = NULL,
            last_activity_at = clock_timestamp(),
            updated_at = clock_timestamp()
        WHERE user_id = ${input.userId}::uuid
            AND session_id = ${input.sessionId}::uuid
            AND generation = ${input.generation}
            AND browser_instance_id = ${input.browserInstanceId}::uuid
            AND lease_id = ${input.leaseId}::uuid
            AND status = 'processing'
        RETURNING user_id AS "userId"
    `)
    return Boolean(rows[0])
}

/** A formally admitted task closes the prior session and starts a fresh budget epoch. */
export async function resetAnalysisConversationAfterTaskAdmission(
    userId: string,
    executor: DatabaseExecutor = db,
) {
    const rows = await executor.execute<{ generation: number | string }>(sql`
        UPDATE public.analysis_conversation_controls
        SET
            generation = CASE WHEN session_id IS NULL THEN generation ELSE generation + 1 END,
            content_kind = NULL,
            status = CASE WHEN session_id IS NULL THEN 'idle' ELSE 'submitted' END,
            lease_id = NULL,
            lease_expires_at = NULL,
            consumed_tokens = 0,
            last_activity_at = clock_timestamp(),
            updated_at = clock_timestamp()
        WHERE user_id = ${userId}::uuid
        RETURNING generation
    `)
    return Boolean(rows[0])
}

/** 正式受理只终结调用方仍然持有的精确任务形成会话。 */
export async function submitAnalysisConversationAfterTaskAdmission(
    input: AnalysisConversationSessionIdentity & { userId: string },
    executor: DatabaseExecutor = db,
) {
    const rows = await executor.execute<{ generation: number | string }>(sql`
        UPDATE public.analysis_conversation_controls
        SET
            generation = generation + 1,
            content_kind = NULL,
            status = 'submitted',
            lease_id = NULL,
            lease_expires_at = NULL,
            consumed_tokens = 0,
            last_activity_at = clock_timestamp(),
            updated_at = clock_timestamp()
        WHERE user_id = ${input.userId}::uuid
            AND session_id = ${input.sessionId}::uuid
            AND generation = ${input.generation}
            AND browser_instance_id = ${input.browserInstanceId}::uuid
            AND status <> 'processing'
            AND NOT EXISTS (
                SELECT 1
                FROM public.analysis_conversation_turn_runs
                WHERE user_id = ${input.userId}::uuid
                    AND session_id = ${input.sessionId}::uuid
                    AND generation = ${input.generation}
                    AND browser_instance_id = ${input.browserInstanceId}::uuid
                    AND status IN ('processing', 'completed')
                    AND expires_at > clock_timestamp()
            )
        RETURNING generation
    `)
    return Boolean(rows[0])
}

/**
 * Close only the caller's still-authoritative conversation. The retained tombstone
 * advances the generation so a disconnected old browser cannot revive its state.
 */
export async function clearAnalysisConversationControl(
    input: AnalysisConversationSessionIdentity & { userId: string },
    executor: DatabaseExecutor = db,
) {
    const rows = await executor.execute<{ generation?: number | string }>(sql`
        INSERT INTO public.analysis_conversation_controls (
            user_id,
            session_id,
            generation,
            browser_instance_id,
            status,
            last_activity_at
        )
        VALUES (
            ${input.userId}::uuid,
            ${input.sessionId}::uuid,
            ${input.generation + 1},
            ${input.browserInstanceId}::uuid,
            'cleared',
            clock_timestamp()
        )
        ON CONFLICT (user_id) DO UPDATE
        SET
            generation = analysis_conversation_controls.generation + 1,
            session_id = excluded.session_id,
            browser_instance_id = excluded.browser_instance_id,
            content_kind = NULL,
            status = 'cleared',
            lease_id = NULL,
            lease_expires_at = NULL,
            consumed_tokens = 0,
            last_activity_at = clock_timestamp(),
            updated_at = clock_timestamp()
        WHERE analysis_conversation_controls.session_id = excluded.session_id
            AND analysis_conversation_controls.generation = ${input.generation}
            AND analysis_conversation_controls.browser_instance_id = excluded.browser_instance_id
        RETURNING generation
    `)
    const row = rows[0]
    if (row) {
        return {
            cleared: true as const,
            generation: Number(row.generation ?? input.generation + 1),
        }
    }

    const current = await getAnalysisConversationControl(input.userId, executor)
    if (!current) {
        return { cleared: false as const, generation: input.generation + 1 }
    }
    throw new AnalysisConversationStaleError()
}
