import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { communityMigrations, createCommunityDatabase } from './community-database'

const owner = '00000000-0000-4000-8000-000000000001'
const otherOwner = '00000000-0000-4000-8000-000000000002'
const cover = '00000000-0000-4000-8000-000000000003'
const fingerprint = 'a'.repeat(64)
const snapshot = {
    structureVersion: 'analysis-task.v6',
    contentKind: 'image',
    rawText: '',
    fields: { title: { value: '合成测试标题' }, body: { value: '' }, topics: { value: ['#测试'] } },
    imageReferences: [cover],
    videoEvidence: null,
    coverReference: cover,
}

async function insertTask(
    database: PGlite,
    userId = owner,
    input: unknown = snapshot,
): Promise<string> {
    const taskId = randomUUID()
    await database.query(
        `INSERT INTO public.analysis_tasks (
            id, user_id, input_mode, structure_config_version, standard_task_snapshot,
            input_fingerprint, quantification_fingerprint, level_fingerprint, generation_fingerprint
        ) VALUES ($1, $2, 'custom', 'analysis-task.v6', $3::jsonb, $4, $4, $4, $4)`,
        [taskId, userId, JSON.stringify(input), fingerprint],
    )
    return taskId
}

async function insertResult(
    database: PGlite,
    taskId: string,
    userId = owner,
    version = 1,
): Promise<void> {
    const report = {
        schemaVersion: 'analysis-result.v7',
        primaryTrack: 0,
        primaryScore: { value: 8, source: 'radar_average' },
        insight: null,
        radar: {
            topicDemand: 8,
            titleExpression: 8,
            contentDevelopment: 8,
            readingExperience: 8,
            interactionPotential: 8,
            distinctiveness: 8,
        },
        differences: [],
        qualitativeConclusion: { summary: '合成测试结论' },
        comparisonNotes: [{ title: '合成案例' }],
        topicSupport: { bonus: 0 },
    }
    const trace = {
        schemaVersion: 'execution-trace.v4',
        taskStructureVersion: 'analysis-task.v6',
        provider: 'mock',
        model: 'synthetic',
        requestId: randomUUID(),
        executionId: 'synthetic',
        algorithmVersion: 'example',
        evidenceSourceVersion: 'synthetic',
        generateResultPromptVersion: 'synthetic',
        evidenceVersion: fingerprint,
        checkupFeatureHash: fingerprint,
        topicEvidence: [],
        matchedNoteCount: 1,
        usage: {},
    }
    await database.query(
        `INSERT INTO public.analysis_results
        (task_id, result_version, user_id, level, result_schema_version, internal_execution_trace, checkup_report)
        VALUES ($1, $2, $3, 8, 'analysis-result.v7', $4::jsonb, $5::jsonb)`,
        [taskId, version, userId, JSON.stringify(trace), JSON.stringify(report)],
    )
}

async function expectSqlFailure(
    database: PGlite,
    action: () => Promise<unknown>,
    code: string,
): Promise<void> {
    await database.exec('SAVEPOINT expected_error')
    try {
        await expect(action()).rejects.toMatchObject({ code })
    } finally {
        await database.exec(
            'ROLLBACK TO SAVEPOINT expected_error; RELEASE SAVEPOINT expected_error',
        )
    }
}

describe('社区版独立数据库', () => {
    let database: PGlite
    beforeAll(async () => {
        database = await createCommunityDatabase()
    }, 30_000)
    afterAll(async () => {
        await database?.close()
    })
    beforeEach(async () => {
        await database.exec('BEGIN')
        await database.query('INSERT INTO auth.users(id) VALUES ($1), ($2)', [owner, otherOwner])
    })
    afterEach(async () => {
        await database.exec('ROLLBACK')
    })

    test('全部业务表启用 RLS，初始为空，不含商业表、商业列或爬取数据', async () => {
        const tables = await database.query<{ name: string; rls: boolean }>(`
            SELECT c.relname AS name, c.relrowsecurity AS rls
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname
        `)
        expect(tables.rows).toHaveLength(27)
        for (const table of tables.rows) {
            expect(table.rls).toBe(true)
            const count = await database.query(
                `SELECT count(*)::integer AS count FROM public."${table.name}"`,
            )
            expect(count.rows).toEqual([{ count: 0 }])
        }
        const sql = communityMigrations.map((migration) => migration.sql).join('\n')
        expect(sql).not.toMatch(
            /\b(?:xiaohongshu|analytics|point_accounts|point_ledger|payment_orders|payment_refunds|refund_requests|admin_accounts|service_incidents|subscription_time_adjustments)\b/u,
        )
        expect(sql).not.toMatch(
            /\b(?:point_cost|reserved_free_points|point_reservation_status|refund_request_id)\b/u,
        )
        expect(sql).not.toMatch(/SECURITY DEFINER/u)
        const topLevel = sql.replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/giu, '')
        expect(topLevel).not.toMatch(/^\s*(?:INSERT INTO|COPY)\s+public\./mu)
    })

    test('用户仅能读取自己的任务，不能读取内部凭据或写入业务表', async () => {
        const ownTask = await insertTask(database)
        await insertTask(database, otherOwner)
        await database.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [owner])
        await database.exec('SET LOCAL ROLE authenticated')
        expect((await database.query('SELECT id FROM public.analysis_tasks')).rows).toEqual([
            { id: ownTask },
        ])
        for (const relation of [
            'skill_device_grants',
            'agent_usage_calls',
            'auth_login_throttles',
            'analysis_assets',
        ]) {
            await expectSqlFailure(
                database,
                () => database.query(`SELECT * FROM public.${relation}`),
                '42501',
            )
        }
        await expectSqlFailure(database, () => insertTask(database), '42501')
        await expectSqlFailure(
            database,
            () => database.query('SELECT internal_execution_trace FROM public.analysis_results'),
            '42501',
        )
        await database.exec('SET LOCAL ROLE anon')
        await expectSqlFailure(
            database,
            () => database.query('SELECT * FROM public.analysis_tasks'),
            '42501',
        )
    })

    test('同账号只有一个活动任务，快照不可改，但状态可进入 processing', async () => {
        const taskId = await insertTask(database)
        await expectSqlFailure(database, () => insertTask(database), '23505')
        await expectSqlFailure(
            database,
            () =>
                database.query(
                    'UPDATE public.analysis_tasks SET standard_task_snapshot = $1 WHERE id = $2',
                    [
                        JSON.stringify({
                            ...snapshot,
                            fields: { ...snapshot.fields, title: { value: '改写' } },
                        }),
                        taskId,
                    ],
                ),
            'P0001',
        )
        await database.query(
            `UPDATE public.analysis_tasks SET status = 'processing', attempt_count = 1,
            started_at = now(), lease_expires_at = now() + interval '1 minute', worker_id = 'synthetic-worker'
            WHERE id = $1`,
            [taskId],
        )
        expect(
            (
                await database.query(
                    'SELECT last_event_id FROM public.workspace_event_versions WHERE user_id = $1',
                    [owner],
                )
            ).rows,
        ).toEqual([{ last_event_id: 2 }])
    })

    test('允许视频不带独立封面，图片必须有封面，空主题和无效视频证据拒绝', async () => {
        const { coverReference: omitted, ...withoutCover } = snapshot
        void omitted
        const video = {
            ...withoutCover,
            contentKind: 'video',
            imageReferences: [],
            videoEvidence: { assetId: cover },
        }
        for (const invalid of [
            withoutCover,
            { ...video, coverReference: null },
            { ...video, videoEvidence: null },
            { ...video, fields: { ...video.fields, topics: { value: [] } } },
        ]) {
            await expectSqlFailure(database, () => insertTask(database, owner, invalid), '23514')
        }
        await insertTask(database, owner, video)
        await insertTask(database, otherOwner, snapshot)
    })

    test('素材会话和证据绑定账号，跨账号引用被外键拒绝', async () => {
        const sessionId = randomUUID()
        const taskId = await insertTask(database, otherOwner)
        await database.query(
            `INSERT INTO public.analysis_media_upload_sessions
            (id, user_id, file_count, total_bytes, expires_at)
            VALUES ($1, $2, 1, 100, now() + interval '5 minutes')`,
            [sessionId, owner],
        )
        await expectSqlFailure(
            database,
            () =>
                database.query(
                    `INSERT INTO public.analysis_assets
            (id, task_id, user_id, position, upload_session_id, file_name, declared_media_type,
            declared_byte_size, original_object_path, upload_expires_at)
            VALUES ($1, $2, $3, 0, $4, 'synthetic.png', 'image/png', 100, 'synthetic/original.png',
            now() + interval '5 minutes')`,
                    [randomUUID(), taskId, owner, sessionId],
                ),
            '23503',
        )
    })

    test('结果不可变且绑定任务账号，完成通知只能引用自己的结果', async () => {
        const taskId = await insertTask(database)
        await insertResult(database, taskId)
        await expectSqlFailure(
            database,
            () => insertResult(database, taskId, otherOwner, 2),
            '23503',
        )
        await expectSqlFailure(
            database,
            () =>
                database.query('UPDATE public.analysis_results SET level = 7 WHERE task_id = $1', [
                    taskId,
                ]),
            'P0001',
        )
        const notification = (userId: string) =>
            database.query(
                `INSERT INTO public.business_notifications
            (user_id, type, payload, analysis_task_id, analysis_result_version, deduplication_key)
            VALUES ($1, 'analysis.completed', jsonb_build_object('taskId', $2::text, 'resultVersion', 1),
                $2::uuid, 1, 'analysis:' || $2::text || ':result:1')`,
                [userId, taskId],
            )
        await notification(owner)
        await expectSqlFailure(database, () => notification(otherOwner), '23503')
        await database.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [otherOwner])
        await database.exec('SET LOCAL ROLE authenticated')
        expect((await database.query('SELECT task_id FROM public.analysis_results')).rows).toEqual(
            [],
        )
        await database.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [owner])
        expect((await database.query('SELECT task_id FROM public.analysis_results')).rows).toEqual([
            { task_id: taskId },
        ])
    })

    test('媒体清理仅服务角色可调用，租约避免立即重复认领，完成后保留元数据', async () => {
        const sessionId = randomUUID()
        const assetId = randomUUID()
        await database.query(
            `INSERT INTO public.analysis_media_upload_sessions
            (id, user_id, file_count, total_bytes, expires_at)
            VALUES ($1, $2, 1, 100, now() + interval '5 minutes')`,
            [sessionId, owner],
        )
        await database.query(
            `INSERT INTO public.analysis_assets
            (id, user_id, position, upload_session_id, file_name, declared_media_type,
            declared_byte_size, original_object_path, upload_expires_at, cleanup_requested_at)
            VALUES ($1, $2, 0, $3, 'synthetic.png', 'image/png', 100, 'synthetic/original.png',
            now() + interval '5 minutes', now())`,
            [assetId, owner, sessionId],
        )
        const activeTaskId = await insertTask(database)
        await database.query(
            `INSERT INTO public.analysis_assets
            (id, task_id, user_id, position, upload_session_id, file_name, declared_media_type,
            declared_byte_size, original_object_path, upload_expires_at, cleanup_requested_at)
            VALUES ($1, $2, $3, 1, $4, 'active.png', 'image/png', 100, 'synthetic/active.png',
            now() + interval '5 minutes', now())`,
            [randomUUID(), activeTaskId, owner, sessionId],
        )
        await database.exec('SET LOCAL ROLE authenticated')
        await expectSqlFailure(
            database,
            () => database.query('SELECT * FROM public.claim_analysis_media_cleanup()'),
            '42501',
        )
        await database.exec('SET LOCAL ROLE service_role')
        expect(
            (await database.query('SELECT id FROM public.claim_analysis_media_cleanup()')).rows,
        ).toEqual([{ id: assetId }])
        expect(
            (await database.query('SELECT id FROM public.claim_analysis_media_cleanup()')).rows,
        ).toEqual([])
        expect(
            (
                await database.query(
                    'SELECT public.complete_analysis_media_cleanup($1, true) AS completed',
                    [assetId],
                )
            ).rows,
        ).toEqual([{ completed: true }])
        expect(
            (
                await database.query(
                    'SELECT state, cleanup_attempt_count FROM public.analysis_assets WHERE id = $1',
                    [assetId],
                )
            ).rows,
        ).toEqual([{ state: 'deleted', cleanup_attempt_count: 1 }])
    })

    test('私有 bucket 和保留调度存在，清理配置缺失时不会发出请求', async () => {
        expect(
            (
                await database.query(
                    'SELECT id, public, file_size_limit FROM storage.buckets ORDER BY id',
                )
            ).rows,
        ).toEqual([
            { id: 'analysis-media', public: false, file_size_limit: 5242880 },
            { id: 'analysis-video', public: false, file_size_limit: 419430400 },
        ])
        const jobs = await database.query<{ command: string }>('SELECT command FROM cron.job')
        expect(jobs.rows).toHaveLength(6)
        expect(
            jobs.rows.some((job) =>
                job.command.includes('teeho_internal.invoke_analysis_media_cleanup'),
            ),
        ).toBe(true)
        expect(
            (
                await database.query(
                    'SELECT teeho_internal.invoke_analysis_media_cleanup() AS request_id',
                )
            ).rows,
        ).toEqual([{ request_id: null }])
        await database.exec('SET LOCAL ROLE authenticated')
        await expectSqlFailure(
            database,
            () => database.query('SELECT teeho_internal.invoke_analysis_media_cleanup()'),
            '42501',
        )
    })

    test('兼容调度 SQL 仅部署角色可调用，不向 service_role 开放 Vault', async () => {
        expect(
            (await database.query('SELECT public.invoke_analysis_media_cleanup() AS request_id'))
                .rows,
        ).toEqual([{ request_id: null }])
        expect(
            (await database.query('SELECT count(*)::integer AS count FROM net.test_requests')).rows,
        ).toEqual([{ count: 0 }])
        await database.query(
            `INSERT INTO vault.decrypted_secrets(name, decrypted_secret)
            VALUES ('teeho_project_url', $1), ('teeho_media_cleanup_secret', $2)`,
            ['https://synthetic.supabase.invalid', 'synthetic-test-secret-not-a-real-credential'],
        )
        expect(
            (await database.query('SELECT public.invoke_analysis_media_cleanup() AS request_id'))
                .rows,
        ).toEqual([{ request_id: 1 }])
        expect(
            (await database.query(`SELECT url, body, timeout_milliseconds FROM net.test_requests`))
                .rows,
        ).toEqual([
            {
                url: 'https://synthetic.supabase.invalid/functions/v1/cleanup-analysis-media',
                body: {},
                timeout_milliseconds: 10000,
            },
        ])
        for (const role of ['anon', 'authenticated', 'service_role']) {
            await database.exec(`SET LOCAL ROLE ${role}`)
            await expectSqlFailure(
                database,
                () => database.query('SELECT public.invoke_analysis_media_cleanup()'),
                '42501',
            )
            await expectSqlFailure(
                database,
                () => database.query('SELECT * FROM vault.decrypted_secrets'),
                '42501',
            )
        }
    })
})

test('保留过程可独立执行，删除过期终态任务但保留活动任务', async () => {
    const database = await createCommunityDatabase()
    try {
        await database.query('INSERT INTO auth.users(id) VALUES ($1)', [owner])
        const activeTaskId = await insertTask(database)
        await database.query(
            `INSERT INTO public.analysis_tasks (
            id, user_id, input_mode, structure_config_version, standard_task_snapshot,
            input_fingerprint, quantification_fingerprint, level_fingerprint, generation_fingerprint,
            status, created_at, completed_at
        ) VALUES ($1, $2, 'custom', 'analysis-task.v6', $3::jsonb, $4, $4, $4, $4,
            'cancelled', now() - interval '26 hours', now() - interval '25 hours')`,
            [randomUUID(), owner, JSON.stringify(snapshot), fingerprint],
        )
        await database.exec('CALL public.cleanup_expired_analysis_data(100, 20)')
        expect((await database.query('SELECT id FROM public.analysis_tasks')).rows).toEqual([
            { id: activeTaskId },
        ])
    } finally {
        await database.close()
    }
}, 30_000)
