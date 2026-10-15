import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createCommunityDatabase } from './community-database'

const OWNER = '00000000-0000-4000-8000-000000000001'
const OTHER_OWNER = '00000000-0000-4000-8000-000000000002'
const COVER = '00000000-0000-4000-8000-000000000003'
const VIDEO = '00000000-0000-4000-8000-000000000004'
const INPUT_FINGERPRINT = 'a'.repeat(64)
const EXECUTION_FINGERPRINT = 'b'.repeat(64)
const PREPARATION = {
    schemaVersion: 'media-preparation.v1',
    deadlineAt: '2026-10-13T10:00:00.000Z',
}
const IMAGE_SNAPSHOT = {
    structureVersion: 'analysis-task.v6',
    contentKind: 'image',
    rawText: '',
    fields: { title: { value: '合成标题' }, body: { value: '' }, topics: { value: ['#测试'] } },
    imageReferences: [COVER],
    coverReference: COVER,
    videoEvidence: null,
    mediaPreparation: PREPARATION,
}
const VIDEO_SNAPSHOT = {
    ...IMAGE_SNAPSHOT,
    contentKind: 'video',
    imageReferences: [],
    mediaPreparation: { ...PREPARATION, videoReference: VIDEO },
}
const VIDEO_EVIDENCE = { assetId: VIDEO, evidenceId: randomUUID() }

function readySnapshot(input: typeof VIDEO_SNAPSHOT): Record<string, unknown> {
    const { mediaPreparation: omitted, ...snapshot } = input
    void omitted
    return { ...snapshot, videoEvidence: VIDEO_EVIDENCE }
}

describe('分析任务素材准备数据库契约', () => {
    let database: PGlite
    beforeAll(async () => {
        database = await createCommunityDatabase()
    }, 30_000)
    afterAll(async () => {
        await database?.close()
    })
    beforeEach(async () => {
        await database.exec('BEGIN')
        await database.query('INSERT INTO auth.users(id) VALUES ($1), ($2)', [OWNER, OTHER_OWNER])
    })
    afterEach(async () => {
        await database.exec('ROLLBACK')
    })

    async function insertTask(
        input: unknown = VIDEO_SNAPSHOT,
        userId = OWNER,
        webResearchEnabled = false,
    ): Promise<string> {
        const taskId = randomUUID()
        await database.query(
            `INSERT INTO public.analysis_tasks (
                id, user_id, input_mode, structure_config_version, standard_task_snapshot,
                input_fingerprint, quantification_fingerprint, level_fingerprint, generation_fingerprint,
                web_research_enabled
            ) VALUES ($1, $2, 'custom', 'analysis-task.v6', $3::jsonb, $4, $4, $4, $4, $5)`,
            [taskId, userId, JSON.stringify(input), INPUT_FINGERPRINT, webResearchEnabled],
        )
        return taskId
    }

    async function expectSqlFailure(action: () => Promise<unknown>, code: string): Promise<void> {
        await database.exec('SAVEPOINT expected_error')
        try {
            await expect(action()).rejects.toMatchObject({ code })
        } finally {
            await database.exec(
                'ROLLBACK TO SAVEPOINT expected_error; RELEASE SAVEPOINT expected_error',
            )
        }
    }

    async function completePreparation(
        taskId: string,
        snapshot: unknown,
        status = 'queued',
    ): Promise<unknown> {
        return database.query(
            `UPDATE public.analysis_tasks SET standard_task_snapshot = $2::jsonb,
                quantification_fingerprint = $3, level_fingerprint = $3, generation_fingerprint = $3,
                status = $4
            WHERE id = $1`,
            [taskId, JSON.stringify(snapshot), EXECUTION_FINGERPRINT, status],
        )
    }

    async function failPreparation(
        taskId: string,
        code = 'media_preparation_failed',
    ): Promise<void> {
        await database.query(
            `UPDATE public.analysis_tasks SET status = 'technical_failed', completed_at = now(),
                failure_code = $2, failure_message = '合成素材准备失败' WHERE id = $1`,
            [taskId, code],
        )
    }

    test('已上传图片和无证据视频可占用活动任务名额，尚未消耗分析尝试', async () => {
        const video = await insertTask()
        const image = await insertTask(IMAGE_SNAPSHOT, OTHER_OWNER)
        expect(
            (
                await database.query(
                    'SELECT id, status, attempt_count, started_at FROM public.analysis_tasks ORDER BY user_id',
                )
            ).rows,
        ).toEqual([
            { id: video, status: 'queued', attempt_count: 0, started_at: null },
            { id: image, status: 'queued', attempt_count: 0, started_at: null },
        ])
        await expectSqlFailure(() => insertTask(), '23505')
    })

    test('拒绝无准备声明的空视频、无效截止日期、素材身份和旧输入契约违规', async () => {
        const { mediaPreparation: omitted, ...withoutPreparation } = VIDEO_SNAPSHOT
        void omitted
        const invalidSnapshots = [
            withoutPreparation,
            ...[
                null,
                [],
                {},
                { ...PREPARATION },
                { ...PREPARATION, videoReference: 'bad' },
                { ...VIDEO_SNAPSHOT.mediaPreparation, deadlineAt: '2026-02-31T00:00:00Z' },
                { ...VIDEO_SNAPSHOT.mediaPreparation, deadlineAt: null },
                { ...VIDEO_SNAPSHOT.mediaPreparation, deadlineAt: 'tomorrow' },
                { ...VIDEO_SNAPSHOT.mediaPreparation, schemaVersion: 'future' },
                { ...VIDEO_SNAPSHOT.mediaPreparation, extra: true },
            ].map((mediaPreparation) => ({ ...VIDEO_SNAPSHOT, mediaPreparation })),
            { ...VIDEO_SNAPSHOT, videoEvidence: VIDEO_EVIDENCE },
            { ...IMAGE_SNAPSHOT, mediaPreparation: VIDEO_SNAPSHOT.mediaPreparation },
            { ...VIDEO_SNAPSHOT, imageReferences: [COVER] },
            { ...VIDEO_SNAPSHOT, coverReference: null },
            { ...VIDEO_SNAPSHOT, fields: { ...VIDEO_SNAPSHOT.fields, title: { value: '' } } },
            { ...VIDEO_SNAPSHOT, fields: { ...VIDEO_SNAPSHOT.fields, topics: { value: [] } } },
            { ...VIDEO_SNAPSHOT, generationPreferences: {} },
        ]
        for (const snapshot of invalidSnapshots) {
            await expectSqlFailure(() => insertTask(snapshot), '23514')
        }
    })

    test('准备完成只补齐同一视频证据和执行指纹，之后快照再次不可变', async () => {
        const taskId = await insertTask()
        const ready = readySnapshot(VIDEO_SNAPSHOT)
        await completePreparation(taskId, ready)
        expect(
            (
                await database.query(
                    `SELECT standard_task_snapshot, input_fingerprint, quantification_fingerprint,
                level_fingerprint, generation_fingerprint, status, attempt_count, started_at
            FROM public.analysis_tasks WHERE id = $1`,
                    [taskId],
                )
            ).rows,
        ).toEqual([
            {
                standard_task_snapshot: ready,
                input_fingerprint: INPUT_FINGERPRINT,
                quantification_fingerprint: EXECUTION_FINGERPRINT,
                level_fingerprint: EXECUTION_FINGERPRINT,
                generation_fingerprint: EXECUTION_FINGERPRINT,
                status: 'queued',
                attempt_count: 0,
                started_at: null,
            },
        ])
        await expectSqlFailure(() => completePreparation(taskId, VIDEO_SNAPSHOT), 'P0001')
        await expectSqlFailure(
            () =>
                completePreparation(taskId, {
                    ...ready,
                    videoEvidence: { ...VIDEO_EVIDENCE, evidenceId: randomUUID() },
                }),
            'P0001',
        )
        await expectSqlFailure(
            () =>
                database.query(
                    'UPDATE public.analysis_tasks SET generation_fingerprint = $2 WHERE id = $1',
                    [taskId, 'c'.repeat(64)],
                ),
            'P0001',
        )
    })

    test('准备完成不可改写原稿、封面、素材、输入指纹或所有权', async () => {
        const taskId = await insertTask()
        const ready = readySnapshot(VIDEO_SNAPSHOT)
        for (const snapshot of [
            { ...ready, videoEvidence: null },
            { ...ready, videoEvidence: { assetId: COVER } },
            { ...ready, imageReferences: [COVER] },
            { ...ready, coverReference: VIDEO },
            { ...ready, fields: { ...VIDEO_SNAPSHOT.fields, body: { value: '篡改' } } },
            { ...ready, additionalField: true },
        ]) {
            await expectSqlFailure(() => completePreparation(taskId, snapshot), 'P0001')
        }
        for (const column of ['input_fingerprint', 'user_id', 'id', 'web_research_enabled']) {
            const value =
                column === 'input_fingerprint'
                    ? EXECUTION_FINGERPRINT
                    : column === 'web_research_enabled'
                      ? true
                      : OTHER_OWNER
            await expectSqlFailure(
                () =>
                    database.query(
                        `UPDATE public.analysis_tasks SET standard_task_snapshot = $2::jsonb,
                    ${column} = $3 WHERE id = $1`,
                        [taskId, JSON.stringify(ready), value],
                    ),
                'P0001',
            )
        }
    })

    test('图片准备也只能移除声明，不能新增或修改输入，并可沿原分析队列执行', async () => {
        const taskId = await insertTask(IMAGE_SNAPSHOT)
        const { mediaPreparation: omitted, ...ready } = IMAGE_SNAPSHOT
        void omitted
        await completePreparation(taskId, ready)
        await expectSqlFailure(() => completePreparation(taskId, IMAGE_SNAPSHOT), 'P0001')
        await database.query(
            `UPDATE public.analysis_tasks SET status = 'processing', attempt_count = 1,
                started_at = now(), lease_expires_at = now() + interval '1 minute',
                worker_id = 'synthetic' WHERE id = $1`,
            [taskId],
        )
        expect(
            (
                await database.query(
                    'SELECT status, attempt_count FROM public.analysis_tasks WHERE id = $1',
                    [taskId],
                )
            ).rows,
        ).toEqual([{ status: 'processing', attempt_count: 1 }])
    })

    test('准备完成遵守已冻结的联网策略，不能跳过研究或意外启动研究', async () => {
        const researchTask = await insertTask(VIDEO_SNAPSHOT, OWNER, true)
        const directTask = await insertTask(VIDEO_SNAPSHOT, OTHER_OWNER, false)
        const ready = readySnapshot(VIDEO_SNAPSHOT)
        await expectSqlFailure(() => completePreparation(researchTask, ready), 'P0001')
        await expectSqlFailure(() => completePreparation(directTask, ready, 'researching'), 'P0001')
        await completePreparation(researchTask, ready, 'researching')
        await completePreparation(directTask, ready)
        expect(
            (
                await database.query(
                    'SELECT status, web_research_enabled FROM public.analysis_tasks ORDER BY user_id',
                )
            ).rows,
        ).toEqual([
            { status: 'researching', web_research_enabled: true },
            { status: 'queued', web_research_enabled: false },
        ])
    })

    test('准备中不能被分析领取，终态后迟到的准备结果不能重新启动任务', async () => {
        const taskId = await insertTask()
        await expectSqlFailure(
            () =>
                database.query(
                    `UPDATE public.analysis_tasks SET status = 'processing', attempt_count = 1,
                started_at = now(), lease_expires_at = now() + interval '1 minute',
                worker_id = 'synthetic', standard_task_snapshot = $2::jsonb WHERE id = $1`,
                    [taskId, JSON.stringify(readySnapshot(VIDEO_SNAPSHOT))],
                ),
            'P0001',
        )
        await expectSqlFailure(
            () =>
                database.query(
                    `UPDATE public.analysis_tasks SET status = 'processing', attempt_count = 1,
                started_at = now(), lease_expires_at = now() + interval '1 minute',
                worker_id = 'synthetic' WHERE id = $1`,
                    [taskId],
                ),
            '23514',
        )
        await database.query(
            "UPDATE public.analysis_tasks SET status = 'cancelled', completed_at = now() WHERE id = $1",
            [taskId],
        )
        await expectSqlFailure(
            () => completePreparation(taskId, readySnapshot(VIDEO_SNAPSHOT)),
            'P0001',
        )
        await expectSqlFailure(
            () =>
                database.query(
                    `UPDATE public.analysis_tasks SET status = 'queued', completed_at = NULL,
                manual_retry_count = 1 WHERE id = $1`,
                    [taskId],
                ),
            'P0001',
        )
    })

    test('准备失败或超时保留attempt0，人工重试仅能刷新截止时间并精确递增次数', async () => {
        const taskId = await insertTask()
        await failPreparation(taskId, 'media_preparation_timeout')
        const retry = {
            ...VIDEO_SNAPSHOT,
            mediaPreparation: {
                ...VIDEO_SNAPSHOT.mediaPreparation,
                deadlineAt: '2026-10-14T10:00:00Z',
            },
        }
        const retryTask = (
            snapshot: unknown,
            retryCount: number,
            fingerprint = INPUT_FINGERPRINT,
        ) =>
            database.query(
                `UPDATE public.analysis_tasks SET status = 'queued', completed_at = NULL,
                    failure_code = NULL, failure_message = NULL, manual_retry_count = $3,
                    standard_task_snapshot = $2::jsonb, generation_fingerprint = $4 WHERE id = $1`,
                [taskId, JSON.stringify(snapshot), retryCount, fingerprint],
            )
        for (const count of [0, 2]) {
            await expectSqlFailure(() => retryTask(retry, count), 'P0001')
        }
        await expectSqlFailure(() => retryTask(VIDEO_SNAPSHOT, 0), 'P0001')
        await expectSqlFailure(() => retryTask(retry, 1, EXECUTION_FINGERPRINT), 'P0001')
        await expectSqlFailure(
            () =>
                retryTask(
                    {
                        ...retry,
                        mediaPreparation: { ...retry.mediaPreparation, videoReference: COVER },
                    },
                    1,
                ),
            'P0001',
        )
        await retryTask(retry, 1)
        await expectSqlFailure(() => retryTask(VIDEO_SNAPSHOT, 2), 'P0001')
        await failPreparation(taskId)
        expect(
            (
                await database.query(
                    'SELECT status, attempt_count, manual_retry_count FROM public.analysis_tasks WHERE id = $1',
                    [taskId],
                )
            ).rows,
        ).toEqual([{ status: 'technical_failed', attempt_count: 0, manual_retry_count: 1 }])
    })

    test('清理保留等待中的图片，任务取消后才允许认领，图片累计重试编号不归零', async () => {
        const taskId = await insertTask(IMAGE_SNAPSHOT)
        const sessionId = randomUUID()
        await database.query(
            `INSERT INTO public.analysis_media_upload_sessions
                (id, user_id, file_count, total_bytes, expires_at)
            VALUES ($1, $2, 1, 100, now() + interval '5 minutes')`,
            [sessionId, OWNER],
        )
        await database.query(
            `INSERT INTO public.analysis_assets (id, task_id, user_id, position, upload_session_id,
                file_name, declared_media_type, declared_byte_size, original_object_path,
                upload_expires_at, cleanup_requested_at, state, processing_attempt_count,
                processing_cycle_start_attempt)
            VALUES ($1, $2, $3, 0, $4, 'synthetic.png', 'image/png', 100,
                'synthetic/preparation.png', now() + interval '5 minutes', now(), 'uploaded', 4, 2)`,
            [COVER, taskId, OWNER, sessionId],
        )
        expect(
            (await database.query('SELECT id FROM public.claim_analysis_media_cleanup()')).rows,
        ).toEqual([])
        for (const cycle of [-1, 5]) {
            await expectSqlFailure(
                () =>
                    database.query(
                        'UPDATE public.analysis_assets SET processing_cycle_start_attempt = $2 WHERE id = $1',
                        [COVER, cycle],
                    ),
                '23514',
            )
        }
        await database.query(
            "UPDATE public.analysis_tasks SET status = 'cancelled', completed_at = now() WHERE id = $1",
            [taskId],
        )
        expect(
            (await database.query('SELECT id FROM public.claim_analysis_media_cleanup()')).rows,
        ).toEqual([{ id: COVER }])
    })

    test('视频重试保留累计尝试历史和唯一键，周期起点不能超前', async () => {
        const sessionId = randomUUID()
        await database.query(
            `INSERT INTO public.analysis_video_upload_sessions(id, user_id, expires_at)
            VALUES ($1, $2, now() + interval '5 minutes')`,
            [sessionId, OWNER],
        )
        await database.query(
            `INSERT INTO public.analysis_video_assets(id, user_id, upload_session_id, file_name,
                declared_media_type, declared_byte_size, original_object_path, upload_expires_at,
                processing_attempt_count, processing_cycle_start_attempt)
            VALUES ($1, $2, $3, 'synthetic.mp4', 'video/mp4', 100,
                'synthetic/preparation.mp4', now() + interval '5 minutes', 4, 2)`,
            [VIDEO, OWNER, sessionId],
        )
        const insertAttempt = (number: number) =>
            database.query(
                `INSERT INTO public.analysis_video_processing_attempts(id, asset_id, attempt_number)
            VALUES ($1, $2, $3)`,
                [randomUUID(), VIDEO, number],
            )
        await insertAttempt(2)
        await insertAttempt(3)
        await expectSqlFailure(() => insertAttempt(2), '23505')
        await expectSqlFailure(() => insertAttempt(0), '23514')
        await expectSqlFailure(
            () =>
                database.query(
                    'UPDATE public.analysis_video_assets SET processing_cycle_start_attempt = 5 WHERE id = $1',
                    [VIDEO],
                ),
            '23514',
        )
        expect(
            (
                await database.query(
                    'SELECT attempt_number FROM public.analysis_video_processing_attempts ORDER BY attempt_number',
                )
            ).rows,
        ).toEqual([{ attempt_number: 2 }, { attempt_number: 3 }])
    })
})
