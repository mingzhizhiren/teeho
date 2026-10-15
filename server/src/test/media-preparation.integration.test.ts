import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import type { PGlite } from '@electric-sql/pglite'
import type { DatabaseExecutor, DatabaseTransaction } from '../db/database'
import { createCommunityDatabase } from '../../../supabase/tests/community-database'

const connection = vi.hoisted(() => ({ database: null as unknown as PGlite }))
vi.mock('../db/database', () => ({
    db: { execute: (statement: SQL) => executorFor(connection.database).execute(statement) },
    withTransaction: <T>(run: (executor: DatabaseTransaction) => Promise<T>) =>
        connection.database.transaction((client) =>
            run(executorFor(client) as DatabaseTransaction),
        ),
}))

import {
    submitAnalysisTask,
    abandonAnalysisTask,
    retryAnalysisTask,
} from '../analysis/analysis.service'
import { findAnalysisTaskById } from '../analysis/tasks/analysis.task.repository'
import {
    advanceAnalysisMediaPreparations,
    MEDIA_PREPARATION,
} from '../analysis/tasks/analysis.media-preparation.service'
import { claimNextAnalysisTask } from '../analysis/tasks/analysis.queue.service'
import {
    insertMediaUploadSession,
    markMediaAssetUploaded,
} from '../analysis/media/analysis.media.repository'
import { cleanupAnalysisUserAssets } from '../analysis/media/analysis.asset-lifecycle.service'
import { configureTaskPolicy, getTaskPolicy } from '../runtime/task-policy'
import { parseAnalysisRequest } from '../analysis/http/analysis.http-input'
import type { AnalysisDraft } from '../analysis/analysis.schema'
import { VIDEO_RULES } from '../config/constants'

const USER = '00000000-0000-4000-8000-000000000101'
const OTHER = '00000000-0000-4000-8000-000000000102'
const IMAGE = '00000000-0000-4000-8000-000000000103'
const TASK = '00000000-0000-4000-8000-000000000104'
const SESSION = '00000000-0000-4000-8000-000000000105'
const VIDEO = '00000000-0000-4000-8000-000000000106'
const VIDEO_SESSION = '00000000-0000-4000-8000-000000000107'
const EVIDENCE = '00000000-0000-4000-8000-000000000108'
const FRAME = '00000000-0000-4000-8000-000000000109'
const originalPolicy = getTaskPolicy()
const reserve = vi.fn(async () => undefined)
const release = vi.fn(async () => undefined)
const draft: AnalysisDraft = {
    inputMode: 'custom',
    rawText: '',
    imageReferences: [IMAGE],
    coverReference: IMAGE,
    fields: { title: '合成测试笔记', body: '仅供自动测试。', topics: ['测试'] },
}
const options = { submissionId: TASK, deferMediaPreparation: true }

/** 真实迁移、SQL与事务，只把外部连接替换为内存 PostgreSQL。 */
function executorFor(client: Pick<PGlite, 'query'>): DatabaseExecutor {
    return {
        async execute(statement: SQL) {
            const query = new PgDialect().sqlToQuery(statement)
            return (await client.query(query.sql, query.params)).rows
        },
    } as DatabaseExecutor
}

async function makeImageReady(): Promise<void> {
    await connection.database.query(
        `UPDATE public.analysis_assets SET state = 'ready',
        processed_object_path = 'synthetic/derived', media_type = 'image/jpeg', byte_size = 512,
        width = 20, height = 20, sha256 = repeat('a',64), original_sha256 = repeat('b',64), ready_at = now(), failure_code = NULL
        WHERE id = $1`,
        [IMAGE],
    )
    await connection.database.query(
        'UPDATE public.analysis_tasks SET available_at = now() WHERE id = $1',
        [TASK],
    )
}

async function seedVideo(): Promise<void> {
    await connection.database.query(
        `INSERT INTO public.analysis_video_upload_sessions(id,user_id,state,expires_at)
        VALUES($1,$2,'queued',now()+interval '1 hour')`,
        [VIDEO_SESSION, USER],
    )
    await connection.database.query(
        `INSERT INTO public.analysis_video_assets
        (id,user_id,upload_session_id,state,file_name,declared_media_type,declared_byte_size,
         original_object_path,upload_expires_at,uploaded_at,queued_at,verified_byte_size)
        VALUES($1,$2,$3,'queued','synthetic.mp4','video/mp4',1024,'synthetic/video',now()+interval '1 hour',now(),now(),1024)`,
        [VIDEO, USER, VIDEO_SESSION],
    )
}

async function makeVideoReady(): Promise<void> {
    await connection.database.query(
        `INSERT INTO public.analysis_video_evidence_packages
        (id,asset_id,evidence_version,original_sha256,duration_ms,width,height,container,video_codec,has_audio,
         media_metadata,pipeline_version,pipeline_config_version,ffmpeg_version,manifest_object_path,generated_at,expires_at)
        VALUES($1,$2,$3,repeat('c',64),1000,100,100,'mp4','h264',false,'{}','synthetic','synthetic','synthetic','synthetic/manifest',now(),now()+interval '1 hour')`,
        [EVIDENCE, VIDEO, VIDEO_RULES.evidenceVersion],
    )
    await connection.database.query(
        `INSERT INTO public.analysis_video_evidence_frames
        (id,evidence_package_id,position,timestamp_ms,selection_reason,object_path,sha256,width,height,byte_size)
        VALUES($1,$2,0,0,'temporal','synthetic/frame',repeat('d',64),100,100,100)`,
        [FRAME, EVIDENCE],
    )
    await connection.database.query(
        "UPDATE public.analysis_video_assets SET state='ready',evidence_id=$1,ready_at=now() WHERE id=$2",
        [EVIDENCE, VIDEO],
    )
    await connection.database.query(
        'UPDATE public.analysis_tasks SET available_at=now() WHERE id=$1',
        [TASK],
    )
}

beforeEach(async () => {
    connection.database = await createCommunityDatabase()
    await connection.database.query('INSERT INTO auth.users(id) VALUES ($1),($2)', [USER, OTHER])
    await insertMediaUploadSession(executorFor(connection.database), {
        sessionId: SESSION,
        userId: USER,
        totalBytes: 1024,
        uploadExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        assetExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        assets: [
            {
                id: IMAGE,
                position: 0,
                fileName: 'synthetic.jpg',
                declaredMediaType: 'image/jpeg',
                declaredByteSize: 1024,
                originalObjectPath: 'synthetic/original',
            },
        ],
    })
    await markMediaAssetUploaded(IMAGE, USER)
    reserve.mockClear()
    release.mockClear()
    configureTaskPolicy({ ...originalPolicy, reserve, release })
}, 30_000)

afterEach(async () => {
    vi.restoreAllMocks()
    configureTaskPolicy(originalPolicy)
    await connection.database?.close()
})

describe('持久化素材准备受理与后台推进', () => {
    it('伪就绪视频缺少关键帧时明确失败，不把空证据交给分析', async () => {
        await seedVideo()
        const { coverReference: omitted, ...input } = draft
        void omitted
        await submitAnalysisTask(
            USER,
            { ...input, imageReferences: [], videoReference: VIDEO },
            options,
        )
        await makeVideoReady()
        await connection.database.query(
            'DELETE FROM public.analysis_video_evidence_frames WHERE evidence_package_id=$1',
            [EVIDENCE],
        )
        await advanceAnalysisMediaPreparations()
        expect(await findAnalysisTaskById(USER, TASK)).toMatchObject({
            status: 'technical_failed',
            failure: { code: 'media_preparation_failed' },
            attemptCount: 0,
        })
        expect(await claimNextAnalysisTask('test-worker', 600, 120)).toBeNull()
        expect(release).toHaveBeenCalledTimes(1)
    })

    it('视频先受理真实上传身份，抽帧就绪后才冻结对应证据', async () => {
        await seedVideo()
        const { coverReference: omitted, ...input } = draft
        void omitted
        const videoDraft = { ...input, imageReferences: [], videoReference: VIDEO }
        const submitted = await submitAnalysisTask(USER, videoDraft, options)
        expect(submitted.task?.standardTask).toMatchObject({
            contentKind: 'video',
            videoEvidence: null,
            mediaPreparation: { videoReference: VIDEO },
        })
        expect(await claimNextAnalysisTask('test-worker', 600, 120)).toBeNull()
        await advanceAnalysisMediaPreparations()
        await makeVideoReady()
        await advanceAnalysisMediaPreparations()
        const ready = await findAnalysisTaskById(USER, TASK)
        expect(ready?.standardTask.videoEvidence).toEqual({
            assetId: VIDEO,
            evidenceId: EVIDENCE,
            evidenceVersion: VIDEO_RULES.evidenceVersion,
            originalSha256: 'c'.repeat(64),
        })
        expect(ready?.standardTask.mediaPreparation).toBeUndefined()
        expect(ready?.inputFingerprint).toBe(submitted.task?.inputFingerprint)
        expect((await submitAnalysisTask(USER, videoDraft, options)).task?.id).toBe(TASK)
        expect(reserve).toHaveBeenCalledTimes(1)
    })

    it('视频已就绪仍等待独立封面，不能丢弃用户指定封面提前启动', async () => {
        await seedVideo()
        await makeVideoReady()
        await submitAnalysisTask(
            USER,
            { ...draft, imageReferences: [], videoReference: VIDEO },
            options,
        )
        await advanceAnalysisMediaPreparations()
        expect((await findAnalysisTaskById(USER, TASK))?.preparationStatus).toBe('waiting')
        await makeImageReady()
        await advanceAnalysisMediaPreparations()
        expect((await findAnalysisTaskById(USER, TASK))?.standardTask).toMatchObject({
            coverReference: IMAGE,
            videoEvidence: { assetId: VIDEO, evidenceId: EVIDENCE },
        })
    })

    it('上传确认后受理，等待不占用分析租约/尝试，就绪后才允许领取', async () => {
        const submitted = await submitAnalysisTask(USER, draft, options)
        expect(submitted.task).toMatchObject({
            id: TASK,
            status: 'queued',
            preparationStatus: 'waiting',
            attemptCount: 0,
            startedAt: null,
        })
        expect(reserve).toHaveBeenCalledTimes(1)
        expect(await claimNextAnalysisTask('test-worker', 600, 120)).toBeNull()
        await advanceAnalysisMediaPreparations()
        expect(await findAnalysisTaskById(USER, TASK)).toMatchObject({
            attemptCount: 0,
            startedAt: null,
        })
        await makeImageReady()
        await advanceAnalysisMediaPreparations()
        const ready = await findAnalysisTaskById(USER, TASK)
        expect(ready?.standardTask.mediaPreparation).toBeUndefined()
        expect(ready?.inputFingerprint).toBe(submitted.task?.inputFingerprint)
        expect(await claimNextAnalysisTask('test-worker', 600, 120)).toMatchObject({
            kind: 'claimed',
            task: { id: TASK, attemptCount: 1 },
        })
        expect(release).not.toHaveBeenCalled()
    })

    it('响应丢失后的重复提交在准备前后都恢复原任务，不重复预留', async () => {
        const first = await submitAnalysisTask(USER, draft, options)
        expect((await submitAnalysisTask(USER, draft, options)).task?.id).toBe(TASK)
        await makeImageReady()
        await advanceAnalysisMediaPreparations()
        const recovered = await submitAnalysisTask(USER, draft, options)
        expect(recovered.task?.inputFingerprint).toBe(first.task?.inputFingerprint)
        expect(recovered.task?.id).toBe(TASK)
        expect(reserve).toHaveBeenCalledTimes(1)
        await expect(
            submitAnalysisTask(
                USER,
                { ...draft, fields: { ...draft.fields, title: '另一份内容' } },
                options,
            ),
        ).rejects.toThrow('提交状态冲突')
    })

    it('同账号跨标签页不同提交ID的相同输入合并到已有任务', async () => {
        await submitAnalysisTask(USER, draft, options)
        const duplicate = await submitAnalysisTask(USER, draft, {
            ...options,
            submissionId: SESSION,
        })
        expect(duplicate.task?.id).toBe(TASK)
        expect(reserve).toHaveBeenCalledTimes(1)
    })

    it('客户端无法用进度或ID绕过上传确认与账号所有权', async () => {
        await connection.database.query(
            "UPDATE public.analysis_assets SET state='awaiting_upload', uploaded_at=NULL WHERE id=$1",
            [IMAGE],
        )
        await expect(submitAnalysisTask(USER, draft, options)).rejects.toThrow('素材尚未上传完成')
        expect(await findAnalysisTaskById(USER, TASK)).toBeNull()
        await markMediaAssetUploaded(IMAGE, USER)
        await expect(submitAnalysisTask(OTHER, draft, options)).rejects.toThrow('素材尚未上传完成')
        expect(await findAnalysisTaskById(OTHER, TASK)).toBeNull()
    })

    it('清理账号数据保留活动任务原件，也不能阻断图片预处理', async () => {
        await submitAnalysisTask(USER, draft, options)
        await cleanupAnalysisUserAssets(USER)
        const assets = await connection.database.query<{
            cleanup_requested_at: string | null
            task_id: string
        }>('SELECT cleanup_requested_at, task_id FROM public.analysis_assets WHERE id=$1', [IMAGE])
        expect(assets.rows[0]).toEqual({ cleanup_requested_at: null, task_id: TASK })
        await makeImageReady()
        await advanceAnalysisMediaPreparations()
        expect(
            (await findAnalysisTaskById(USER, TASK))?.standardTask.mediaPreparation,
        ).toBeUndefined()
    })

    it('最终素材失败终结任务并只释放一次，迟到就绪不会复活', async () => {
        await submitAnalysisTask(USER, draft, options)
        await connection.database.query(
            "UPDATE public.analysis_assets SET state='failed', processing_attempt_count=2, failure_code='image_processing_failed' WHERE id=$1",
            [IMAGE],
        )
        await advanceAnalysisMediaPreparations()
        expect(await findAnalysisTaskById(USER, TASK)).toMatchObject({
            status: 'technical_failed',
            attemptCount: 0,
            failure: { code: 'media_preparation_failed' },
        })
        expect(release).toHaveBeenCalledTimes(1)
        await makeImageReady()
        await advanceAnalysisMediaPreparations()
        expect((await findAnalysisTaskById(USER, TASK))?.status).toBe('technical_failed')
        expect(release).toHaveBeenCalledTimes(1)
    })

    it('准备独立超时释放积分，不启动分析时间预算', async () => {
        await submitAnalysisTask(USER, draft, options)
        vi.spyOn(Date, 'now').mockReturnValue(Date.now() + MEDIA_PREPARATION.timeoutMs + 1)
        await advanceAnalysisMediaPreparations()
        expect(await findAnalysisTaskById(USER, TASK)).toMatchObject({
            status: 'technical_failed',
            startedAt: null,
            attemptCount: 0,
            failure: { code: 'media_preparation_timeout' },
        })
        expect(release).toHaveBeenCalledTimes(1)
    })

    it('取消先于就绪时不再推进，只有取消事务释放预留', async () => {
        await submitAnalysisTask(USER, draft, options)
        await abandonAnalysisTask(USER, TASK)
        await advanceAnalysisMediaPreparations()
        expect((await findAnalysisTaskById(USER, TASK))?.status).toBe('abandoned')
        expect(await claimNextAnalysisTask('test-worker', 600, 120)).toBeNull()
        expect(release).toHaveBeenCalledTimes(1)
    })

    it('显式人工重试开启新两次周期而不重置素材累计尝试号', async () => {
        await submitAnalysisTask(USER, draft, options)
        await connection.database.query(
            "UPDATE public.analysis_assets SET state='failed', processing_attempt_count=2, failure_code='image_processing_failed' WHERE id=$1",
            [IMAGE],
        )
        await advanceAnalysisMediaPreparations()
        await retryAnalysisTask(USER, TASK)
        const assets = await connection.database.query<{
            processing_attempt_count: number
            processing_cycle_start_attempt: number
            state: string
        }>(
            'SELECT processing_attempt_count, processing_cycle_start_attempt, state FROM public.analysis_assets WHERE id=$1',
            [IMAGE],
        )
        expect(assets.rows[0]).toEqual({
            processing_attempt_count: 2,
            processing_cycle_start_attempt: 2,
            state: 'uploaded',
        })
        expect(await findAnalysisTaskById(USER, TASK)).toMatchObject({
            status: 'queued',
            manualRetryCount: 1,
            attemptCount: 0,
        })
        expect(reserve).toHaveBeenCalledTimes(2)
        await makeImageReady()
        await advanceAnalysisMediaPreparations()
        expect(
            (await findAnalysisTaskById(USER, TASK))?.standardTask.mediaPreparation,
        ).toBeUndefined()
    })

    it('HTTP显式选项经过类型校验，客户端不能注入内部准备快照', () => {
        expect(parseAnalysisRequest({ ...draft, ...options })).toMatchObject({
            success: true,
            data: { deferMediaPreparation: true },
        })
        expect(parseAnalysisRequest({ ...draft, deferMediaPreparation: 'true' })).toMatchObject({
            success: false,
        })
        expect(parseAnalysisRequest({ ...draft, mediaPreparation: {} })).toMatchObject({
            success: false,
        })
    })
})
