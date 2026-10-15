import { PGlite } from '@electric-sql/pglite'
import { type SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DatabaseExecutor } from '../../db/database'
import { requestAnalysisAssetCleanup } from './analysis.asset-lifecycle.repository'
import { resetFailedPreparationMedia } from './analysis.preparation-retry.repository'
import {
    claimNextMediaAsset,
    markMediaAssetFailed,
    markMediaAssetReady,
    requestMediaAssetCleanup,
} from './analysis.media.repository'

const databaseMocks = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('../../db/database', () => ({ db: databaseMocks }))

const userId = '00000000-0000-4000-8000-000000000001'
const taskId = '00000000-0000-4000-8000-000000000002'
const assetId = '00000000-0000-4000-8000-000000000003'
const unusedAssetId = '00000000-0000-4000-8000-000000000004'
const processed = {
    mediaType: 'image/jpeg' as const,
    byteSize: 20,
    width: 10,
    height: 10,
    originalSha256: 'a'.repeat(64),
    processedSha256: 'b'.repeat(64),
    content: new Uint8Array(20),
}
let database: PGlite

beforeEach(async () => {
    database = new PGlite()
    databaseMocks.execute.mockImplementation(async (statement: SQL) => {
        const query = new PgDialect().sqlToQuery(statement)
        return (await database.query(query.sql, query.params)).rows
    })
    await database.exec(`
        CREATE TABLE analysis_tasks (id uuid PRIMARY KEY, user_id uuid, status text);
        CREATE TABLE analysis_assets (
            id uuid PRIMARY KEY, user_id uuid, task_id uuid, position integer DEFAULT 0,
            upload_session_id uuid, state text DEFAULT 'uploaded', file_name text DEFAULT 'image.jpg',
            declared_media_type text DEFAULT 'image/jpeg', declared_byte_size integer DEFAULT 20,
            original_object_path text DEFAULT 'test/original.jpg', processed_object_path text,
            media_type text, byte_size integer, width integer, height integer, sha256 text,
            original_sha256 text, processing_attempt_count integer DEFAULT 0,
            processing_cycle_start_attempt integer DEFAULT 0, failure_code text,
            expires_at timestamptz DEFAULT now() + interval '1 hour', ready_at timestamptz,
            processing_started_at timestamptz, cleanup_requested_at timestamptz,
            created_at timestamptz DEFAULT now()
        );
    `)
    await database.query("INSERT INTO analysis_tasks VALUES ($1,$2,'queued')", [taskId, userId])
    await database.query('INSERT INTO analysis_assets(id,user_id,task_id) VALUES($1,$2,$3)', [
        assetId,
        userId,
        taskId,
    ])
})

afterEach(async () => {
    await database.close()
})

async function cleanup(taskOnly = false): Promise<number> {
    return database.transaction(async (transaction) => {
        const executor = {
            async execute(statement: SQL) {
                const query = new PgDialect().sqlToQuery(statement)
                return (await transaction.query(query.sql, query.params)).rows
            },
        } as unknown as DatabaseExecutor
        return taskOnly
            ? requestMediaAssetCleanup(executor, taskId, userId)
            : requestAnalysisAssetCleanup({ userId }, executor)
    })
}

describe('素材准备的真实 SQL 状态边界', () => {
    it('已绑定待准备任务的图片仍可领取，首次失败重试一次，第二次失败结束', async () => {
        await expect(claimNextMediaAsset(60)).resolves.toMatchObject({ processingAttemptCount: 1 })
        await markMediaAssetFailed(assetId, 'image_processing_failed', 1)
        await expect(claimNextMediaAsset(60)).resolves.toMatchObject({ processingAttemptCount: 2 })
        await markMediaAssetFailed(assetId, 'image_decode_failed', 2)
        await expect(claimNextMediaAsset(60)).resolves.toBeNull()
        expect(
            (await database.query('SELECT state, failure_code FROM analysis_assets')).rows,
        ).toEqual([{ state: 'failed', failure_code: 'image_decode_failed' }])
    })

    it('第二次尝试丢失后由租约回收进入失败，旧尝试不能写入ready或覆盖新尝试', async () => {
        await claimNextMediaAsset(60)
        await database.exec(
            "UPDATE analysis_assets SET processing_started_at = now() - interval '2 minutes'",
        )
        await expect(claimNextMediaAsset(60)).resolves.toMatchObject({ processingAttemptCount: 2 })
        await markMediaAssetFailed(assetId, 'late_failure', 1)
        await expect(markMediaAssetReady(assetId, 'test/stale.jpg', processed, 1)).resolves.toBe(
            false,
        )
        expect((await database.query('SELECT state FROM analysis_assets')).rows).toEqual([
            { state: 'processing' },
        ])
        await database.exec(
            "UPDATE analysis_assets SET processing_started_at = now() - interval '2 minutes'",
        )
        await expect(claimNextMediaAsset(60)).resolves.toBeNull()
        expect(
            (await database.query('SELECT state, failure_code FROM analysis_assets')).rows,
        ).toEqual([{ state: 'failed', failure_code: 'image_processing_timeout' }])
        await expect(markMediaAssetReady(assetId, 'test/late.jpg', processed, 2)).resolves.toBe(
            false,
        )
    })

    it('用户手动重试开启新周期且旧周期的迟到回写不会污染新处理', async () => {
        await claimNextMediaAsset(60)
        await markMediaAssetFailed(assetId, 'image_processing_failed', 1)
        await claimNextMediaAsset(60)
        await markMediaAssetFailed(assetId, 'image_processing_failed', 2)
        await resetFailedPreparationMedia(
            databaseMocks as unknown as DatabaseExecutor,
            userId,
            taskId,
            {
                imageReferences: [assetId],
            },
        )
        await expect(claimNextMediaAsset(60)).resolves.toMatchObject({ processingAttemptCount: 3 })
        await markMediaAssetFailed(assetId, 'old_attempt_failed', 1)
        await expect(
            markMediaAssetReady(assetId, 'test/old-cycle.jpg', processed, 2),
        ).resolves.toBe(false)
        await markMediaAssetFailed(assetId, 'image_processing_failed', 3)
        await expect(claimNextMediaAsset(60)).resolves.toMatchObject({ processingAttemptCount: 4 })
        await markMediaAssetFailed(assetId, 'image_processing_failed', 4)
        await expect(claimNextMediaAsset(60)).resolves.toBeNull()
    })

    it.each(['queued', 'researching', 'processing', 'retrying'])(
        '清理账号跳过%s任务素材，继续准备成功；已取消后允许清理',
        async (status) => {
            await database.query('UPDATE analysis_tasks SET status=$1', [status])
            await database.query('INSERT INTO analysis_assets(id,user_id) VALUES($1,$2)', [
                unusedAssetId,
                userId,
            ])
            await expect(cleanup()).resolves.toBe(1)
            await expect(cleanup(true)).resolves.toBe(0)
            await expect(claimNextMediaAsset(60)).resolves.toMatchObject({ id: assetId })
            await expect(
                markMediaAssetReady(assetId, 'test/ready.jpg', processed, 1),
            ).resolves.toBe(true)
            expect(
                (
                    await database.query(
                        'SELECT cleanup_requested_at FROM analysis_assets WHERE id=$1',
                        [assetId],
                    )
                ).rows,
            ).toEqual([{ cleanup_requested_at: null }])
            await database.exec("UPDATE analysis_tasks SET status='cancelled'")
            await expect(cleanup(true)).resolves.toBe(1)
        },
    )
})
