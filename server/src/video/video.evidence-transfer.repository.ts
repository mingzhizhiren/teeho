import { sql } from 'drizzle-orm'

import { VIDEO_RULES } from '../config/constants'
import { db, withTransaction, type DatabaseExecutor } from '../db/database'
import type {
    OwnedVideoEvidenceTransferFrame,
    OwnedVideoEvidenceTransferRecord,
    VideoEvidenceRestoreSessionRecord,
    VideoEvidenceTransferPersistence,
} from './video.evidence-transfer'

interface EvidenceRow extends Record<string, unknown> {
    assetId: string
    userId: string
    assetState: OwnedVideoEvidenceTransferRecord['assetState']
    evidenceId: string
    evidenceVersion: string
    originalSha256: string
    durationMs: number | string
    width: number | string
    height: number | string
    container: string
    videoCodec: string
    hasAudio: boolean
    mediaMetadata: unknown
    pipelineVersion: string
    pipelineConfigVersion: string
    ffmpegVersion: string
    manifestObjectPath: string
    generatedAt: Date | string
    expiresAt: Date | string
    cleanupState: OwnedVideoEvidenceTransferRecord['cleanupState']
}

interface FrameRow extends Record<string, unknown> {
    position: number | string
    timestampMs: number | string
    selectionReason: string
    objectPath: string
    sha256: string
    width: number | string
    height: number | string
    byteSize: number | string
    mediaType: string
}

interface RestoreSessionRow extends Record<string, unknown> {
    sessionId: string
    evidenceId: string
    state: VideoEvidenceRestoreSessionRecord['state']
    manifestObjectPath: string
    frameObjectPaths: unknown
    expiresAt: Date | string
}

function iso(value: Date | string) {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function mapFrames(rows: FrameRow[]): OwnedVideoEvidenceTransferFrame[] {
    return rows.map((row) => ({
        position: Number(row.position),
        timestampMs: Number(row.timestampMs),
        selectionReason: row.selectionReason,
        objectPath: row.objectPath,
        sha256: row.sha256,
        width: Number(row.width),
        height: Number(row.height),
        byteSize: Number(row.byteSize),
        mediaType: row.mediaType as 'image/webp',
    }))
}

function mapRestoreSession(row: RestoreSessionRow): VideoEvidenceRestoreSessionRecord {
    const frameObjectPaths = Array.isArray(row.frameObjectPaths)
        ? row.frameObjectPaths.filter((path): path is string => typeof path === 'string')
        : []
    return {
        sessionId: row.sessionId,
        evidenceId: row.evidenceId,
        state: row.state,
        manifestObjectPath: row.manifestObjectPath,
        frameObjectPaths,
        expiresAt: iso(row.expiresAt),
    }
}

/** 读取账号拥有的视频证据，保留过期元数据供浏览器恢复时比对。 */
export async function findOwnedVideoEvidenceTransfer(
    userId: string,
    videoId: string,
    executor: DatabaseExecutor = db,
): Promise<OwnedVideoEvidenceTransferRecord | null> {
    const packages = await executor.execute<EvidenceRow>(sql`
        SELECT
            asset.id::text AS "assetId",
            asset.user_id::text AS "userId",
            asset.state AS "assetState",
            evidence.id::text AS "evidenceId",
            evidence.evidence_version AS "evidenceVersion",
            evidence.original_sha256 AS "originalSha256",
            evidence.duration_ms AS "durationMs",
            evidence.width,
            evidence.height,
            evidence.container,
            evidence.video_codec AS "videoCodec",
            evidence.has_audio AS "hasAudio",
            evidence.media_metadata AS "mediaMetadata",
            evidence.pipeline_version AS "pipelineVersion",
            evidence.pipeline_config_version AS "pipelineConfigVersion",
            evidence.ffmpeg_version AS "ffmpegVersion",
            evidence.manifest_object_path AS "manifestObjectPath",
            evidence.generated_at AS "generatedAt",
            evidence.expires_at AS "expiresAt",
            evidence.cleanup_state AS "cleanupState"
        FROM public.analysis_video_assets AS asset
        JOIN public.analysis_video_evidence_packages AS evidence
          ON evidence.id = asset.evidence_id
         AND evidence.asset_id = asset.id
        WHERE asset.id = ${videoId}::uuid
          AND asset.user_id = ${userId}::uuid
        LIMIT 1
    `)
    const evidence = packages[0]
    if (!evidence) {
        return null
    }
    const frameRows = await executor.execute<FrameRow>(sql`
        SELECT
            frame.position,
            frame.timestamp_ms AS "timestampMs",
            frame.selection_reason AS "selectionReason",
            frame.object_path AS "objectPath",
            frame.sha256,
            frame.width,
            frame.height,
            frame.byte_size AS "byteSize",
            frame.media_type AS "mediaType"
        FROM public.analysis_video_evidence_frames AS frame
        WHERE frame.evidence_package_id = ${evidence.evidenceId}::uuid
        ORDER BY frame.position
    `)
    const metadata = evidence.mediaMetadata
    return {
        assetId: evidence.assetId,
        userId: evidence.userId,
        assetState: evidence.assetState,
        evidenceId: evidence.evidenceId,
        evidenceVersion: evidence.evidenceVersion,
        originalSha256: evidence.originalSha256,
        durationMs: Number(evidence.durationMs),
        width: Number(evidence.width),
        height: Number(evidence.height),
        container: evidence.container,
        videoCodec: evidence.videoCodec,
        hasAudio: evidence.hasAudio,
        mediaMetadata:
            typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
                ? (metadata as Record<string, unknown>)
                : {},
        pipelineVersion: evidence.pipelineVersion,
        pipelineConfigVersion: evidence.pipelineConfigVersion,
        ffmpegVersion: evidence.ffmpegVersion,
        manifestObjectPath: evidence.manifestObjectPath,
        generatedAt: iso(evidence.generatedAt),
        expiresAt: iso(evidence.expiresAt),
        cleanupState: evidence.cleanupState,
        frames: mapFrames(frameRows),
    }
}

/** 为已完成云端清理的同版本证据建立一次短期恢复会话。 */
export function beginVideoEvidenceRestore(input: {
    sessionId: string
    userId: string
    videoId: string
    evidenceId: string
    manifestObjectPath: string
    frameObjectPaths: string[]
    expiresAt: string
}) {
    return withTransaction(async (transaction) => {
        await transaction.execute(sql`
            UPDATE public.analysis_video_evidence_restore_sessions
            SET state = 'expired', updated_at = now()
            WHERE evidence_package_id = ${input.evidenceId}::uuid
              AND state = 'issued'
              AND expires_at <= now()
        `)
        const inserted = await transaction.execute<RestoreSessionRow>(sql`
            INSERT INTO public.analysis_video_evidence_restore_sessions (
                id,
                user_id,
                asset_id,
                evidence_package_id,
                state,
                manifest_object_path,
                frame_object_paths,
                expires_at
            )
            SELECT
                ${input.sessionId}::uuid,
                ${input.userId}::uuid,
                asset.id,
                evidence.id,
                'issued',
                ${input.manifestObjectPath},
                ${JSON.stringify(input.frameObjectPaths)}::jsonb,
                ${input.expiresAt}::timestamptz
            FROM public.analysis_video_assets AS asset
            JOIN public.analysis_video_evidence_packages AS evidence
              ON evidence.id = asset.evidence_id
             AND evidence.asset_id = asset.id
            WHERE asset.id = ${input.videoId}::uuid
              AND asset.user_id = ${input.userId}::uuid
              AND evidence.id = ${input.evidenceId}::uuid
              AND evidence.evidence_version = ${VIDEO_RULES.evidenceVersion}
              AND evidence.pipeline_version = ${VIDEO_RULES.pipelineVersion}
              AND evidence.pipeline_config_version = ${VIDEO_RULES.pipelineConfigVersion}
              AND evidence.expires_at <= now()
              AND evidence.cleanup_state = 'deleted'
            RETURNING
                id::text AS "sessionId",
                evidence_package_id::text AS "evidenceId",
                state,
                manifest_object_path AS "manifestObjectPath",
                frame_object_paths AS "frameObjectPaths",
                expires_at AS "expiresAt"
        `)
        const row = inserted[0]
        if (!row) {
            throw new Error('视频证据尚未完成云端清理或恢复状态已改变')
        }
        return mapRestoreSession(row)
    })
}

/** 读取账号、视频和会话三重绑定的恢复资格。 */
export async function findOwnedVideoEvidenceRestoreSession(
    userId: string,
    videoId: string,
    sessionId: string,
    executor: DatabaseExecutor = db,
) {
    const rows = await executor.execute<RestoreSessionRow>(sql`
        SELECT
            session.id::text AS "sessionId",
            session.evidence_package_id::text AS "evidenceId",
            session.state,
            session.manifest_object_path AS "manifestObjectPath",
            session.frame_object_paths AS "frameObjectPaths",
            session.expires_at AS "expiresAt"
        FROM public.analysis_video_evidence_restore_sessions AS session
        WHERE session.id = ${sessionId}::uuid
          AND session.user_id = ${userId}::uuid
          AND session.asset_id = ${videoId}::uuid
        LIMIT 1
    `)
    return rows[0] ? mapRestoreSession(rows[0]) : null
}

/** 复核成功后原子切换新对象路径并续期同一证据版本。 */
export function completeVideoEvidenceRestore(
    userId: string,
    sessionId: string,
    replacement: {
        manifestObjectPath: string
        frameObjectPaths: string[]
        expiresAt: string
    },
) {
    return withTransaction(async (transaction) => {
        const sessions = await transaction.execute<RestoreSessionRow & { assetId: string }>(sql`
            UPDATE public.analysis_video_evidence_restore_sessions
            SET state = 'completed', completed_at = now(), updated_at = now()
            WHERE id = ${sessionId}::uuid
              AND user_id = ${userId}::uuid
              AND state = 'issued'
              AND expires_at > now()
            RETURNING
                id::text AS "sessionId",
                asset_id::text AS "assetId",
                evidence_package_id::text AS "evidenceId",
                state,
                manifest_object_path AS "manifestObjectPath",
                frame_object_paths AS "frameObjectPaths",
                expires_at AS "expiresAt"
        `)
        const session = sessions[0]
        if (!session || replacement.frameObjectPaths.length === 0) {
            return false
        }
        const frames = await transaction.execute<
            { position: number | string } & Record<string, unknown>
        >(sql`
            SELECT position
            FROM public.analysis_video_evidence_frames
            WHERE evidence_package_id = ${session.evidenceId}::uuid
            ORDER BY position
            FOR UPDATE
        `)
        if (frames.length !== replacement.frameObjectPaths.length) {
            throw new Error('恢复帧数量与原证据不一致')
        }
        for (const frame of frames) {
            const position = Number(frame.position)
            await transaction.execute(sql`
                UPDATE public.analysis_video_evidence_frames
                SET object_path = ${replacement.frameObjectPaths[position]}
                WHERE evidence_package_id = ${session.evidenceId}::uuid
                  AND position = ${position}
            `)
        }
        await transaction.execute(sql`
            UPDATE public.analysis_video_evidence_packages
            SET manifest_object_path = ${replacement.manifestObjectPath},
                expires_at = ${replacement.expiresAt}::timestamptz,
                cleanup_state = 'retained',
                cleanup_attempt_count = 0,
                cleanup_next_attempt_at = NULL,
                cleanup_last_error_code = NULL,
                cleanup_worker_id = NULL,
                cleanup_lease_expires_at = NULL,
                deleted_at = NULL,
                updated_at = now()
            WHERE id = ${session.evidenceId}::uuid
        `)
        await transaction.execute(sql`
            UPDATE public.analysis_video_assets
            SET state = 'ready', ready_at = now(), updated_at = now()
            WHERE id = ${session.assetId}::uuid
              AND user_id = ${userId}::uuid
        `)
        return true
    })
}

/** 将失败恢复会话终结；新上传的部分对象由业务服务幂等删除。 */
export async function failVideoEvidenceRestore(
    userId: string,
    sessionId: string,
    errorCode: string,
    executor: DatabaseExecutor = db,
) {
    await executor.execute(sql`
        UPDATE public.analysis_video_evidence_restore_sessions
        SET state = 'failed',
            failure_code = LEFT(${errorCode}, 100),
            updated_at = now()
        WHERE id = ${sessionId}::uuid
          AND user_id = ${userId}::uuid
          AND state = 'issued'
    `)
}

/** PostgreSQL 视频证据传输持久化实现。 */
export const postgresVideoEvidenceTransferPersistence: VideoEvidenceTransferPersistence = {
    findOwned: findOwnedVideoEvidenceTransfer,
    beginRestore: beginVideoEvidenceRestore,
    findRestore: findOwnedVideoEvidenceRestoreSession,
    completeRestore: completeVideoEvidenceRestore,
    failRestore: failVideoEvidenceRestore,
}
