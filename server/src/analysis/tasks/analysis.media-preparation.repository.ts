import { sql } from 'drizzle-orm'
import { db, type DatabaseExecutor } from '../../db/database'
import { AnalysisAssetExpiredError } from '../analysis.errors'
import { requiredAnalysisImageReferences } from '../media/analysis.media-input'
import {
    videoEvidenceReferenceSchema,
    type StandardAnalysisTask,
    type VideoEvidenceReference,
} from '../analysis.schema'
import type { AnalysisFingerprints } from '../analysis.fingerprints'
import { analysisUploadConstraints } from '../analysis.constants'

interface ImageState extends Record<string, unknown> {
    id: string
    state: string
    sha256: string | null
    isValid: boolean
    declaredByteSize: number | string
}
interface VideoState extends Record<string, unknown> {
    id: string
    state: string
    nextAttemptAt: Date | string | null
    evidence: unknown
    isValid: boolean
}
export interface PreparingTaskRow extends Record<string, unknown> {
    id: string
    userId: string
    standardTask: unknown
    createdAt: Date | string
}
export type PreparationMediaState =
    | { kind: 'waiting' }
    | { kind: 'failed' }
    | { kind: 'ready'; imageDigests: string[]; videoEvidence: VideoEvidenceReference | null }

function ids(values: readonly string[]) {
    return sql.join(
        values.map((value) => sql`${value}::uuid`),
        sql`, `,
    )
}

async function lockImages(
    executor: DatabaseExecutor,
    userId: string,
    references: readonly string[],
) {
    if (!references.length) return []
    return executor.execute<ImageState>(sql`
        SELECT asset.id::text AS id, asset.state, asset.sha256,
            asset.declared_byte_size AS "declaredByteSize",
            (asset.expires_at > now() AND asset.cleanup_requested_at IS NULL) AS "isValid"
        FROM public.analysis_assets asset
        WHERE asset.user_id = ${userId}::uuid AND asset.id IN (${ids(references)})
        ORDER BY asset.id FOR UPDATE OF asset
    `)
}

async function lockVideo(executor: DatabaseExecutor, userId: string, videoId: string) {
    await executor.execute(sql`
        SELECT id FROM public.analysis_video_assets
        WHERE id = ${videoId}::uuid AND user_id = ${userId}::uuid FOR UPDATE
    `)
    // 与证据清理共享锁；等待资产锁后使用新快照读取，避免受理即将删除的证据。
    await executor.execute(sql`
        SELECT evidence.id FROM public.analysis_video_evidence_packages evidence
        JOIN public.analysis_video_assets asset ON asset.evidence_id = evidence.id AND evidence.asset_id = asset.id
        WHERE asset.id = ${videoId}::uuid AND asset.user_id = ${userId}::uuid
        FOR SHARE OF evidence
    `)
    const rows = await executor.execute<VideoState>(sql`
        SELECT asset.id::text AS id, asset.state, asset.next_attempt_at AS "nextAttemptAt",
            CASE WHEN evidence.id IS NOT NULL THEN jsonb_build_object(
                'assetId', asset.id, 'evidenceId', evidence.id,
                'evidenceVersion', evidence.evidence_version,
                'originalSha256', evidence.original_sha256) ELSE NULL END AS evidence,
            (asset.uploaded_at IS NOT NULL AND asset.cancellation_requested_at IS NULL AND
                CASE WHEN asset.state = 'ready' THEN
                    evidence.expires_at > now() AND evidence.cleanup_state = 'retained'
                ELSE asset.original_cleanup_state IN ('retained', 'cleanup_failed') END
            ) AS "isValid"
        FROM public.analysis_video_assets asset
        LEFT JOIN public.analysis_video_evidence_packages evidence
            ON evidence.id = asset.evidence_id AND evidence.asset_id = asset.id
        WHERE asset.id = ${videoId}::uuid AND asset.user_id = ${userId}::uuid
    `)
    return rows[0] ?? null
}

/** 受理与清理共用资产行锁；仅绑定已由后端确认上传的同账号素材。 */
export async function bindPreparingMedia(
    executor: DatabaseExecutor,
    taskId: string,
    userId: string,
    task: StandardAnalysisTask,
): Promise<void> {
    const references = requiredAnalysisImageReferences(task)
    const images = await lockImages(executor, userId, references)
    if (
        new Set(references).size !== references.length ||
        references.length > analysisUploadConstraints.maxFiles ||
        images.reduce((total, image) => total + Number(image.declaredByteSize), 0) >
            analysisUploadConstraints.maxTotalBytes
    )
        throw new AnalysisAssetExpiredError('图片数量或总容量超过限制')
    if (
        images.length !== references.length ||
        images.some(
            (image) => !image.isValid || !['uploaded', 'processing', 'ready'].includes(image.state),
        )
    ) {
        throw new AnalysisAssetExpiredError('素材尚未上传完成或已失效，请重新上传')
    }
    if (references.length) {
        const conflicts = await executor.execute(sql`
            SELECT asset.id FROM public.analysis_assets asset
            JOIN public.analysis_tasks owner ON owner.id = asset.task_id
            WHERE asset.id IN (${ids(references)}) AND owner.id <> ${taskId}::uuid
                AND owner.status IN ('researching', 'queued', 'processing', 'retrying')
        `)
        if (conflicts.length) throw new AnalysisAssetExpiredError('素材已用于另一活动任务')
    }
    const videoId = task.mediaPreparation?.videoReference
    if (videoId) {
        const video = await lockVideo(executor, userId, videoId)
        if (!video?.isValid || !['uploaded', 'queued', 'processing', 'ready'].includes(video.state))
            throw new AnalysisAssetExpiredError('视频尚未上传完成或已失效，请重新上传')
        const conflicts = await executor.execute(sql`
            SELECT id FROM public.analysis_tasks WHERE user_id = ${userId}::uuid
                AND id <> ${taskId}::uuid
                AND status IN ('researching', 'queued', 'processing', 'retrying')
                AND (standard_task_snapshot #>> '{videoEvidence,assetId}' = ${videoId}
                    OR standard_task_snapshot #>> '{mediaPreparation,videoReference}' = ${videoId})
        `)
        if (conflicts.length) throw new AnalysisAssetExpiredError('视频已用于另一活动任务')
    }
    for (const [position, assetId] of references.entries())
        await executor.execute(sql`
        UPDATE public.analysis_assets SET task_id = ${taskId}::uuid, position = ${position}
        WHERE id = ${assetId}::uuid AND user_id = ${userId}::uuid
    `)
}

/** 按检查时间轮转，避免未就绪的早期任务饿死后来的就绪任务。 */
export async function listPreparingTasks(limit: number): Promise<{ id: string; userId: string }[]> {
    const rows = await db.execute<{ id: string; userId: string }>(sql`
        SELECT id::text AS id, user_id::text AS "userId" FROM public.analysis_tasks
        WHERE status = 'queued' AND standard_task_snapshot ? 'mediaPreparation'
            AND available_at <= now()
        ORDER BY available_at, id LIMIT ${limit}
    `)
    return [...rows]
}

/** 准备、取消及成功推进共享同一任务锁，重启后仍可直接从数据库恢复。 */
export async function lockPreparingTask(
    executor: DatabaseExecutor,
    taskId: string,
    userId: string,
): Promise<PreparingTaskRow | null> {
    const rows = await executor.execute<PreparingTaskRow>(sql`
        SELECT id::text AS id, user_id::text AS "userId", standard_task_snapshot AS "standardTask",
            created_at AS "createdAt" FROM public.analysis_tasks
        WHERE id = ${taskId}::uuid AND user_id = ${userId}::uuid
            AND status = 'queued' AND standard_task_snapshot ? 'mediaPreparation'
            AND started_at IS NULL AND attempt_count = 0 FOR UPDATE SKIP LOCKED
    `)
    return rows[0] ?? null
}

/** 读取处理结果的真实身份；缺失、过期和最终失败都不能被当作就绪。 */
export async function readPreparationMedia(
    executor: DatabaseExecutor,
    userId: string,
    task: StandardAnalysisTask,
): Promise<PreparationMediaState> {
    const references = requiredAnalysisImageReferences(task)
    const images = await lockImages(executor, userId, references)
    if (
        images.length !== references.length ||
        images.some(
            (image) => !image.isValid || !['uploaded', 'processing', 'ready'].includes(image.state),
        )
    )
        return { kind: 'failed' }
    const videoId = task.mediaPreparation?.videoReference
    const video = videoId ? await lockVideo(executor, userId, videoId) : null
    if (
        videoId &&
        (!video?.isValid ||
            !['uploaded', 'queued', 'processing', 'ready', 'technical_failed'].includes(
                video.state,
            ))
    )
        return { kind: 'failed' }
    if (video?.state === 'technical_failed' && !video.nextAttemptAt) return { kind: 'failed' }
    if (images.some((image) => image.state !== 'ready') || (video && video.state !== 'ready'))
        return { kind: 'waiting' }
    if (images.some((image) => !image.sha256)) return { kind: 'failed' }
    const evidence = video ? videoEvidenceReferenceSchema.safeParse(video.evidence) : null
    if (evidence && !evidence.success) return { kind: 'failed' }
    return {
        kind: 'ready',
        imageDigests: references.map((id) => images.find((image) => image.id === id)!.sha256!),
        videoEvidence: evidence?.success ? evidence.data : null,
    }
}

/** 独立等待周期不增加分析尝试次数或启动分析计时。 */
export async function deferPreparationCheck(
    executor: DatabaseExecutor,
    taskId: string,
    pollSeconds: number,
): Promise<void> {
    await executor.execute(sql`UPDATE public.analysis_tasks
        SET available_at = now() + (${pollSeconds} * interval '1 second') WHERE id = ${taskId}::uuid`)
}

/** 原子完善一次执行快照；迁移触发器继续保护已冻结的用户输入和提交身份。 */
export async function completeMediaPreparation(
    executor: DatabaseExecutor,
    taskId: string,
    task: StandardAnalysisTask,
    fingerprints: AnalysisFingerprints,
): Promise<void> {
    await executor.execute(sql`UPDATE public.analysis_tasks SET
        status = CASE WHEN web_research_enabled THEN 'researching' ELSE 'queued' END,
        standard_task_snapshot = ${JSON.stringify(task)}::jsonb,
        quantification_fingerprint = ${fingerprints.quantification},
        level_fingerprint = ${fingerprints.level}, generation_fingerprint = ${fingerprints.generation},
        available_at = now(), updated_at = now() WHERE id = ${taskId}::uuid`)
}

/** 准备失败与积分释放由调用方同一事务提交。 */
export async function failMediaPreparation(
    executor: DatabaseExecutor,
    taskId: string,
    code: 'media_preparation_failed' | 'media_preparation_timeout',
): Promise<void> {
    const message =
        code === 'media_preparation_timeout'
            ? '素材准备超时，请稍后重试'
            : '素材准备失败，请重试或重新上传素材'
    await executor.execute(sql`UPDATE public.analysis_tasks SET status = 'technical_failed',
        failure_code = ${code}, failure_message = ${message}, completed_at = now(), updated_at = now()
        WHERE id = ${taskId}::uuid`)
}

/** 用户明确重试才重设等待截止；不会修改任何已确认输入或自动无限重试。 */
export async function requeueMediaPreparation(
    executor: DatabaseExecutor,
    taskId: string,
    userId: string,
    deadlineAt: string,
): Promise<boolean> {
    const rows = await executor.execute(sql`UPDATE public.analysis_tasks SET status = 'queued',
        standard_task_snapshot = jsonb_set(standard_task_snapshot, '{mediaPreparation,deadlineAt}', ${JSON.stringify(deadlineAt)}::jsonb),
        manual_retry_count = manual_retry_count + 1, attempt_count = 0,
        queued_at = now(), available_at = now(), started_at = NULL, lease_expires_at = NULL,
        worker_id = NULL, completed_at = NULL, failure_code = NULL, failure_message = NULL, updated_at = now()
        WHERE id = ${taskId}::uuid AND user_id = ${userId}::uuid AND status = 'technical_failed'
            AND standard_task_snapshot ? 'mediaPreparation' RETURNING id`)
    return rows.length > 0
}
