import { sql } from 'drizzle-orm'

import type { VideoAssetRecord, VideoAssetState, VideoMediaType } from './video.contract'

/** 数据库返回的视频资产原始行。 */
export interface VideoAssetRow extends Record<string, unknown> {
    id: string
    userId: string
    uploadSessionId: string
    state: VideoAssetState
    fileName: string
    declaredMediaType: VideoMediaType
    declaredByteSize: number | string
    originalObjectPath: string
    uploadExpiresAt: Date | string
    processingAttemptCount: number | string
    failureCode: string | null
    evidenceId: string | null
    queuePosition: number | string | null
    createdAt: Date | string
    updatedAt: Date | string
}

/** 视频资产查询共用的字段投影。 */
export const videoAssetSelection = sql`
    asset.id::text AS id,
    asset.user_id::text AS "userId",
    asset.upload_session_id::text AS "uploadSessionId",
    asset.state,
    asset.file_name AS "fileName",
    asset.declared_media_type AS "declaredMediaType",
    asset.declared_byte_size AS "declaredByteSize",
    asset.original_object_path AS "originalObjectPath",
    asset.upload_expires_at AS "uploadExpiresAt",
    asset.processing_attempt_count AS "processingAttemptCount",
    asset.failure_code AS "failureCode",
    asset.evidence_id::text AS "evidenceId",
    CASE
        WHEN asset.state = 'queued' THEN (
            SELECT count(*)
            FROM public.analysis_video_assets queued
            WHERE queued.state = 'queued'
              AND (queued.queued_at, queued.id) <= (asset.queued_at, asset.id)
        )
        ELSE NULL
    END AS "queuePosition",
    asset.created_at AS "createdAt",
    asset.updated_at AS "updatedAt"
`

function iso(value: Date | string) {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

/** 将数据库视频资产行转换为稳定的领域记录。 */
export function mapVideoAsset(row: VideoAssetRow): VideoAssetRecord {
    return {
        ...row,
        declaredByteSize: Number(row.declaredByteSize),
        processingAttemptCount: Number(row.processingAttemptCount),
        queuePosition: row.queuePosition === null ? null : Number(row.queuePosition),
        uploadExpiresAt: iso(row.uploadExpiresAt),
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.updatedAt),
    }
}
