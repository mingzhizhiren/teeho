import { sql } from 'drizzle-orm'

import { db, type DatabaseExecutor } from '../../db/database'
import { maintenanceClaimAllowedSql } from '../../runtime/task-policy'
import { analysisMediaConstraints, analysisUploadConstraints } from '../analysis.constants'
import { AnalysisAssetExpiredError } from '../analysis.errors'
import type { ProcessedAnalysisImage } from './analysis.media'

export type AnalysisMediaState =
    | 'awaiting_upload'
    | 'uploaded'
    | 'processing'
    | 'ready'
    | 'failed'
    | 'expired'
    | 'deleting'
    | 'deleted'
    | 'cleanup_failed'

export interface AnalysisMediaAssetRecord {
    id: string
    userId: string
    taskId: string | null
    position: number | null
    uploadSessionId: string
    state: AnalysisMediaState
    fileName: string
    declaredMediaType: 'image/jpeg' | 'image/png' | 'image/webp'
    declaredByteSize: number
    originalObjectPath: string
    processedObjectPath: string | null
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | null
    byteSize: number | null
    width: number | null
    height: number | null
    sha256: string | null
    originalSha256: string | null
    processingAttemptCount: number
    failureCode: string | null
    expiresAt: string
}

interface AnalysisMediaRow extends Record<string, unknown> {
    id: string
    userId: string
    taskId: string | null
    position: number | string | null
    uploadSessionId: string
    state: AnalysisMediaState
    fileName: string
    declaredMediaType: AnalysisMediaAssetRecord['declaredMediaType']
    declaredByteSize: number | string
    originalObjectPath: string
    processedObjectPath: string | null
    mediaType: AnalysisMediaAssetRecord['mediaType']
    byteSize: number | string | null
    width: number | string | null
    height: number | string | null
    sha256: string | null
    originalSha256: string | null
    processingAttemptCount: number | string
    failureCode: string | null
    expiresAt: Date | string
}

const mediaSelection = sql`
    id::text AS id,
    user_id::text AS "userId",
    task_id::text AS "taskId",
    "position",
    upload_session_id::text AS "uploadSessionId",
    state,
    file_name AS "fileName",
    declared_media_type AS "declaredMediaType",
    declared_byte_size AS "declaredByteSize",
    original_object_path AS "originalObjectPath",
    processed_object_path AS "processedObjectPath",
    media_type AS "mediaType",
    byte_size AS "byteSize",
    width,
    height,
    sha256,
    original_sha256 AS "originalSha256",
    processing_attempt_count AS "processingAttemptCount",
    failure_code AS "failureCode",
    expires_at AS "expiresAt"
`

function mapMediaRow(row: AnalysisMediaRow): AnalysisMediaAssetRecord {
    return {
        ...row,
        position: row.position === null ? null : Number(row.position),
        declaredByteSize: Number(row.declaredByteSize),
        byteSize: row.byteSize === null ? null : Number(row.byteSize),
        width: row.width === null ? null : Number(row.width),
        height: row.height === null ? null : Number(row.height),
        processingAttemptCount: Number(row.processingAttemptCount),
        expiresAt:
            row.expiresAt instanceof Date
                ? row.expiresAt.toISOString()
                : new Date(row.expiresAt).toISOString(),
    }
}

export interface InsertMediaUploadSessionParam {
    sessionId: string
    userId: string
    totalBytes: number
    uploadExpiresAt: string
    assetExpiresAt: string
    assets: Array<{
        id: string
        position: number
        fileName: string
        declaredMediaType: AnalysisMediaAssetRecord['declaredMediaType']
        declaredByteSize: number
        originalObjectPath: string
    }>
}

export interface ReadyMediaBindingRow extends Record<string, unknown> {
    id: string
    taskId: string | null
    declaredByteSize: number | string
}

/**
 * 在任务绑定边界重新汇总素材限制，防止拆分多个上传会话绕过批次上限。
 * 数据必须来自已按账号、ready 状态和有效期锁定的数据库记录。
 */
export function assertReadyMediaBinding(
    taskId: string,
    assetIds: string[],
    rows: ReadyMediaBindingRow[],
) {
    if (assetIds.length > analysisUploadConstraints.maxFiles) {
        throw new Error('图片数量超过限制')
    }

    const byId = new Map(rows.map((row) => [row.id, row]))
    const uniqueAssetIds = new Set(assetIds)
    if (
        uniqueAssetIds.size !== assetIds.length ||
        byId.size !== assetIds.length ||
        assetIds.some((id) => {
            const row = byId.get(id)
            return !row || (row.taskId !== null && row.taskId !== taskId)
        })
    ) {
        throw new Error('分析图片未就绪、已过期或不属于当前账号')
    }

    const totalBytes = assetIds.reduce(
        (total, id) => total + Number(byId.get(id)!.declaredByteSize),
        0,
    )
    if (!Number.isSafeInteger(totalBytes) || totalBytes > analysisUploadConstraints.maxTotalBytes) {
        throw new Error('图片总量超过限制')
    }
}

/** 在调用方事务中创建上传会话及其有序素材记录。 */
export async function insertMediaUploadSession(
    executor: DatabaseExecutor,
    param: InsertMediaUploadSessionParam,
) {
    await executor.execute(sql`
        INSERT INTO public.analysis_media_upload_sessions (
            id, user_id, file_count, total_bytes, expires_at
        )
        VALUES (
            ${param.sessionId}::uuid,
            ${param.userId}::uuid,
            ${param.assets.length},
            ${param.totalBytes},
            ${param.uploadExpiresAt}::timestamptz
        )
    `)
    const values = sql.join(
        param.assets.map(
            (asset) => sql`(
                ${asset.id}::uuid,
                ${param.userId}::uuid,
                ${asset.position},
                ${param.sessionId}::uuid,
                ${asset.fileName},
                ${asset.declaredMediaType},
                ${asset.declaredByteSize},
                ${asset.originalObjectPath},
                ${param.uploadExpiresAt}::timestamptz,
                ${param.assetExpiresAt}::timestamptz
            )`,
        ),
        sql`, `,
    )
    await executor.execute(sql`
        INSERT INTO public.analysis_assets (
            id,
            user_id,
            "position",
            upload_session_id,
            file_name,
            declared_media_type,
            declared_byte_size,
            original_object_path,
            upload_expires_at,
            expires_at
        )
        VALUES ${values}
    `)
}

function identifiers(ids: string[]) {
    return sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
    )
}

/** 按当前账号读取素材；调用方负责按请求顺序重新排列。 */
export async function findOwnedMediaAssets(userId: string, ids: string[]) {
    if (ids.length === 0) {
        return []
    }
    const rows = await db.execute<AnalysisMediaRow>(sql`
        SELECT ${mediaSelection}
        FROM public.analysis_assets
        WHERE user_id = ${userId}::uuid
            AND id IN (${identifiers(ids)})
    `)
    return rows.map(mapMediaRow)
}

/** 判断当前账号请求的任一图片是否已因草稿上传超限而作废。 */
export async function hasMediaAssetCleanupRequested(userId: string, ids: string[]) {
    if (ids.length === 0) return false
    const rows = await db.execute<{ id: string }>(sql`
        SELECT id::text AS id
        FROM public.analysis_assets
        WHERE user_id = ${userId}::uuid
          AND id IN (${identifiers(ids)})
          AND cleanup_requested_at IS NOT NULL
        LIMIT 1
    `)
    return rows.length > 0
}

/** 确认对象已直传后，将素材投入异步处理队列。 */
export async function markMediaAssetUploaded(assetId: string, userId: string) {
    const rows = await db.execute<AnalysisMediaRow>(sql`
        UPDATE public.analysis_assets
        SET state = 'uploaded', uploaded_at = COALESCE(uploaded_at, now())
        WHERE id = ${assetId}::uuid
            AND user_id = ${userId}::uuid
            AND state IN ('awaiting_upload', 'uploaded')
            AND upload_expires_at > now()
            AND cleanup_requested_at IS NULL
        RETURNING ${mediaSelection}
    `)
    return rows[0] ? mapMediaRow(rows[0]) : null
}

/** 原子领取一张待处理素材，并回收进程异常留下的过期处理租约。 */
export async function claimNextMediaAsset(processingLeaseSeconds: number) {
    const rows = await db.execute<AnalysisMediaRow>(sql`
        WITH candidate AS (
            SELECT id AS candidate_id
            FROM public.analysis_assets
            WHERE expires_at > now()
                AND ${maintenanceClaimAllowedSql()}
                AND cleanup_requested_at IS NULL
                AND processing_attempt_count < ${analysisMediaConstraints.maxProcessingAttempts}
                AND (
                    state = 'uploaded'
                    OR (
                        state = 'processing'
                        AND processing_started_at < now() - (${processingLeaseSeconds} * interval '1 second')
                    )
                )
            ORDER BY created_at, id
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        UPDATE public.analysis_assets AS asset
        SET
            state = 'processing',
            processing_started_at = now(),
            processing_attempt_count = processing_attempt_count + 1,
            failure_code = NULL
        FROM candidate
        WHERE asset.id = candidate.candidate_id
        RETURNING ${mediaSelection}
    `)
    return rows[0] ? mapMediaRow(rows[0]) : null
}

/** 保存处理后的对象元数据并把素材置为 ready。 */
export async function markMediaAssetReady(
    assetId: string,
    processedObjectPath: string,
    processed: ProcessedAnalysisImage,
) {
    const rows = await db.execute<{ id: string }>(sql`
        UPDATE public.analysis_assets
        SET
            state = 'ready',
            processed_object_path = ${processedObjectPath},
            media_type = ${processed.mediaType},
            byte_size = ${processed.byteSize},
            width = ${processed.width},
            height = ${processed.height},
            sha256 = ${processed.processedSha256},
            original_sha256 = ${processed.originalSha256},
            ready_at = now(),
            failure_code = NULL
        WHERE id = ${assetId}::uuid
            AND state = 'processing'
            AND cleanup_requested_at IS NULL
        RETURNING id::text AS id
    `)
    return rows.length > 0
}

/** 记录安全错误码；达到上限后保持失败供用户移除或显式重试。 */
export async function markMediaAssetFailed(assetId: string, failureCode: string) {
    await db.execute(sql`
        UPDATE public.analysis_assets
        SET state = 'failed', failure_code = ${failureCode}
        WHERE id = ${assetId}::uuid
            AND state = 'processing'
    `)
}

/** 用户显式重试仍在保留期内的失败素材。 */
export async function retryMediaAsset(assetId: string, userId: string) {
    const rows = await db.execute<{ id: string }>(sql`
        UPDATE public.analysis_assets
        SET state = 'uploaded', failure_code = NULL
        WHERE id = ${assetId}::uuid
            AND user_id = ${userId}::uuid
            AND state = 'failed'
            AND processing_attempt_count < ${analysisMediaConstraints.maxProcessingAttempts}
            AND expires_at > now()
            AND cleanup_requested_at IS NULL
        RETURNING id::text AS id
    `)
    return rows.length > 0
}

/** 任务事务内验证并绑定全部 ready 素材，客户端元数据不参与判断。 */
export async function bindReadyMediaAssets(
    executor: DatabaseExecutor,
    taskId: string,
    userId: string,
    assetIds: string[],
) {
    if (assetIds.length === 0) {
        return
    }
    const rows = await executor.execute<ReadyMediaBindingRow>(sql`
        SELECT
            id::text AS id,
            task_id::text AS "taskId",
            declared_byte_size AS "declaredByteSize"
        FROM public.analysis_assets
        WHERE user_id = ${userId}::uuid
            AND id IN (${identifiers(assetIds)})
            AND state = 'ready'
            AND expires_at > now()
        FOR UPDATE
    `)
    assertReadyMediaBinding(taskId, assetIds, rows)
    for (const [position, assetId] of assetIds.entries()) {
        await executor.execute(sql`
            UPDATE public.analysis_assets
            SET task_id = ${taskId}::uuid, "position" = ${position}
            WHERE id = ${assetId}::uuid
                AND user_id = ${userId}::uuid
        `)
    }
}

/** 复用仍有效的派生图并将清理保护交给新任务；不延长过期时间。 */
export async function reuseReadyMediaAssetsForCheckup(
    executor: DatabaseExecutor,
    taskId: string,
    userId: string,
    assetIds: readonly string[],
): Promise<void> {
    if (assetIds.length === 0) return
    const rows = await executor.execute<{ id: string }>(sql`
        UPDATE public.analysis_assets AS asset
        SET task_id = ${taskId}::uuid
        WHERE asset.user_id = ${userId}::uuid
            AND asset.id IN (${identifiers([...assetIds])})
            AND asset.state = 'ready'
            AND asset.expires_at > now()
            AND asset.cleanup_requested_at IS NULL
            AND NOT EXISTS (
                SELECT 1 FROM public.analysis_tasks AS owner_task
                WHERE owner_task.id = asset.task_id
                    AND owner_task.status IN ('researching', 'queued', 'processing', 'retrying')
            )
        RETURNING asset.id::text AS id
    `)
    if (rows.length !== assetIds.length || new Set(assetIds).size !== assetIds.length) {
        throw new AnalysisAssetExpiredError('素材已过期或正在清理，请重新上传后体检')
    }
}

/** Worker 按不可变快照引用读取当前账号仍有效的派生素材。 */
export async function findReadyMediaAssetsForReferences(userId: string, assetIds: string[]) {
    if (assetIds.length === 0) return []
    const rows = await db.execute<AnalysisMediaRow>(sql`
        SELECT ${mediaSelection}
        FROM public.analysis_assets
        WHERE user_id = ${userId}::uuid
            AND id IN (${identifiers(assetIds)})
            AND state = 'ready'
            AND expires_at > now()
    `)
    return rows.map(mapMediaRow)
}

/** 计数快照引用中当前账号仍可供 Agent 使用的图片。 */
export async function countReadyMediaAssetsForReferences(
    executor: DatabaseExecutor,
    userId: string,
    assetIds: readonly string[],
) {
    if (assetIds.length === 0) return 0
    const rows = await executor.execute<{ count: number | string }>(sql`
        SELECT count(*)::int AS count
        FROM public.analysis_assets
        WHERE user_id = ${userId}::uuid
            AND id IN (${identifiers([...assetIds])})
            AND state = 'ready'
            AND expires_at > now()
    `)
    return Number(rows[0]?.count ?? 0)
}

/** 提前清理只登记意图，真实对象由 Edge Function 删除。 */
export async function requestMediaAssetCleanup(
    executor: DatabaseExecutor,
    taskId: string,
    userId: string,
) {
    const rows = await executor.execute<{ id: string }>(sql`
        UPDATE public.analysis_assets
        SET cleanup_requested_at = COALESCE(cleanup_requested_at, now())
        WHERE task_id = ${taskId}::uuid
            AND user_id = ${userId}::uuid
            AND state NOT IN ('deleted', 'deleting')
        RETURNING id::text AS id
    `)
    return rows.length
}
