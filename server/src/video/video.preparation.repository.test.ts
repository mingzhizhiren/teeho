import { PGlite } from '@electric-sql/pglite'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetFailedPreparationMedia } from '../analysis/media/analysis.preparation-retry.repository'
import type { DatabaseTransaction } from '../db/database'
import { cancelVideoAsset } from './video.repository'
import {
    claimNextVideoAsset,
    claimVideoEvidenceCleanup,
    claimVideoOriginalCleanup,
    markVideoFailed,
    recoverExpiredVideoLeases,
} from './video.worker.repository'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), withTransaction: vi.fn() }))
vi.mock('../db/database', () => ({
    db: { execute: mocks.execute },
    withTransaction: mocks.withTransaction,
}))

const userId = '00000000-0000-4000-8000-000000000001'
const assetId = '00000000-0000-4000-8000-000000000002'
const taskId = '00000000-0000-4000-8000-000000000003'
const evidenceId = '00000000-0000-4000-8000-000000000004'
let database: PGlite

function executor(connection: Pick<PGlite, 'query'>): DatabaseTransaction {
    return {
        async execute(statement: SQL) {
            const query = new PgDialect().sqlToQuery(statement)
            return (await connection.query(query.sql, query.params)).rows
        },
    } as unknown as DatabaseTransaction
}

beforeEach(async () => {
    database = new PGlite()
    mocks.execute.mockImplementation(executor(database).execute)
    mocks.withTransaction.mockImplementation(
        (callback: (transaction: DatabaseTransaction) => Promise<unknown>) =>
            database.transaction((transaction) => callback(executor(transaction))),
    )
    await database.exec(`
        CREATE TABLE analysis_tasks (id uuid PRIMARY KEY, user_id uuid, status text, standard_task_snapshot jsonb);
        CREATE TABLE analysis_video_assets (
            id uuid PRIMARY KEY, user_id uuid, upload_session_id uuid, state text DEFAULT 'queued',
            file_name text DEFAULT 'video.mp4', declared_media_type text DEFAULT 'video/mp4',
            declared_byte_size integer DEFAULT 20, original_object_path text DEFAULT 'test/original.mp4',
            upload_expires_at timestamptz DEFAULT now()+interval '1 hour',
            processing_attempt_count integer DEFAULT 0, processing_cycle_start_attempt integer DEFAULT 0,
            failure_code text, failure_detail text, evidence_id uuid, next_attempt_at timestamptz,
            queued_at timestamptz DEFAULT now(), processing_started_at timestamptz, cancellation_requested_at timestamptz,
            created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
            original_cleanup_state text DEFAULT 'retained', original_cleanup_attempt_count integer DEFAULT 0,
            original_cleanup_next_attempt_at timestamptz, original_cleanup_lease_expires_at timestamptz,
            original_cleanup_last_error_code text, original_cleanup_worker_id text
        );
        CREATE TABLE analysis_video_upload_sessions (id uuid PRIMARY KEY, user_id uuid, state text, updated_at timestamptz);
        CREATE TABLE analysis_video_processing_attempts (
            id uuid PRIMARY KEY, asset_id uuid, attempt_number integer, state text, worker_id text,
            lease_expires_at timestamptz, heartbeat_at timestamptz, completed_at timestamptz,
            failure_code text, updated_at timestamptz, UNIQUE(asset_id, attempt_number)
        );
        CREATE TABLE analysis_video_start_events (
            id uuid DEFAULT gen_random_uuid(), asset_id uuid PRIMARY KEY, user_id uuid, state text,
            started_at timestamptz, released_at timestamptz, release_reason text, updated_at timestamptz
        );
        CREATE TABLE analysis_video_evidence_packages (
            id uuid PRIMARY KEY, asset_id uuid, manifest_object_path text, expires_at timestamptz,
            cleanup_state text DEFAULT 'retained', cleanup_attempt_count integer DEFAULT 0,
            cleanup_next_attempt_at timestamptz, cleanup_lease_expires_at timestamptz,
            cleanup_last_error_code text, cleanup_worker_id text, updated_at timestamptz
        );
        CREATE TABLE analysis_video_evidence_restore_sessions (evidence_package_id uuid, state text, expires_at timestamptz);
        CREATE TABLE analysis_video_evidence_frames (evidence_package_id uuid, position integer, object_path text);
    `)
    await database.query(
        'INSERT INTO analysis_video_assets(id,user_id,upload_session_id) VALUES($1,$2,$1)',
        [assetId, userId],
    )
    await database.query(
        "INSERT INTO analysis_video_upload_sessions VALUES($1,$2,'queued',now())",
        [assetId, userId],
    )
})

afterEach(async () => {
    await database.close()
})

async function addTask(reference: 'preparation' | 'evidence', status = 'queued'): Promise<void> {
    const snapshot =
        reference === 'preparation'
            ? {
                  mediaPreparation: {
                      schemaVersion: 'media-preparation.v1',
                      videoReference: assetId,
                  },
              }
            : { videoEvidence: { assetId } }
    await database.query('INSERT INTO analysis_tasks VALUES($1,$2,$3,$4)', [
        taskId,
        userId,
        status,
        JSON.stringify(snapshot),
    ])
}

describe('视频准备与任务引用的真实 SQL 边界', () => {
    it.each(['technical', 'deterministic'] as const)(
        '%s失败只自动重试一次，显式手动重试保留历史并重开两次预算',
        async (kind) => {
            await addTask('preparation', 'technical_failed')
            await expect(claimNextVideoAsset('worker', 60_000)).resolves.toMatchObject({
                processingAttemptCount: 1,
            })
            await expect(
                markVideoFailed(assetId, 'worker', { kind, code: 'video_processing_failed' }),
            ).resolves.toBe('retry_scheduled')
            await expect(claimNextVideoAsset('worker', 60_000)).resolves.toMatchObject({
                processingAttemptCount: 2,
            })
            await expect(
                markVideoFailed(assetId, 'worker', { kind, code: 'video_processing_failed' }),
            ).resolves.toBe('terminal')
            await expect(claimNextVideoAsset('worker', 60_000)).resolves.toBeNull()
            await resetFailedPreparationMedia(executor(database), userId, taskId, {
                imageReferences: [],
                mediaPreparation: {
                    schemaVersion: 'media-preparation.v1',
                    videoReference: assetId,
                    deadlineAt: '2030-01-01T00:00:00.000Z',
                },
            })
            await expect(claimNextVideoAsset('worker-new-cycle', 60_000)).resolves.toMatchObject({
                processingAttemptCount: 3,
            })
            await expect(
                markVideoFailed(assetId, 'worker', { kind, code: 'late_failure' }),
            ).resolves.toBe('stale')
            await expect(
                markVideoFailed(assetId, 'worker-new-cycle', {
                    kind,
                    code: 'video_processing_failed',
                }),
            ).resolves.toBe('retry_scheduled')
            await expect(claimNextVideoAsset('worker-new-cycle', 60_000)).resolves.toMatchObject({
                processingAttemptCount: 4,
            })
            await expect(
                markVideoFailed(assetId, 'worker-new-cycle', {
                    kind,
                    code: 'video_processing_failed',
                }),
            ).resolves.toBe('terminal')
            expect(
                (
                    await database.query(
                        'SELECT attempt_number FROM analysis_video_processing_attempts ORDER BY attempt_number',
                    )
                ).rows,
            ).toEqual([1, 2, 3, 4].map((attempt_number) => ({ attempt_number })))
        },
    )

    it('租约两次丢失后终态；活动任务仍持有失败素材，任务结束后才能清理原片', async () => {
        await addTask('preparation')
        await claimNextVideoAsset('worker', 60_000)
        await database.exec(
            "UPDATE analysis_video_processing_attempts SET lease_expires_at=now()-interval '1 minute'",
        )
        await expect(recoverExpiredVideoLeases()).resolves.toBe(1)
        await expect(claimNextVideoAsset('worker-recovered', 60_000)).resolves.toMatchObject({
            processingAttemptCount: 2,
        })
        await database.exec(
            "UPDATE analysis_video_processing_attempts SET lease_expires_at=now()-interval '1 minute' WHERE state='processing'",
        )
        await expect(recoverExpiredVideoLeases()).resolves.toBe(1)
        await expect(claimNextVideoAsset('worker', 60_000)).resolves.toBeNull()
        await expect(claimVideoOriginalCleanup('cleanup', 60_000)).resolves.toBeNull()
        await database.exec("UPDATE analysis_tasks SET status='technical_failed'")
        await expect(claimVideoOriginalCleanup('cleanup', 60_000)).resolves.toMatchObject({
            assetId,
        })
        await expect(
            resetFailedPreparationMedia(executor(database), userId, taskId, {
                imageReferences: [],
                mediaPreparation: {
                    schemaVersion: 'media-preparation.v1',
                    videoReference: assetId,
                    deadlineAt: '2030-01-01T00:00:00.000Z',
                },
            }),
        ).rejects.toMatchObject({ reason: 'analysis_video_evidence_expired' })
    })

    it.each(['preparation', 'evidence'] as const)(
        '%s引用的活动任务视频不能取消，任务取消后允许取消素材',
        async (reference) => {
            await addTask(reference)
            await expect(cancelVideoAsset(userId, assetId)).resolves.toBeNull()
            expect((await database.query('SELECT state FROM analysis_video_assets')).rows).toEqual([
                { state: 'queued' },
            ])
            await database.exec("UPDATE analysis_tasks SET status='cancelled'")
            await expect(cancelVideoAsset(userId, assetId)).resolves.toMatchObject({
                state: 'cancelled',
            })
        },
    )

    it.each(['preparation', 'evidence'] as const)(
        '%s引用保护活动任务过期视频证据，终态后恢复清理',
        async (reference) => {
            await addTask(reference)
            await database.query(
                "INSERT INTO analysis_video_evidence_packages(id,asset_id,manifest_object_path,expires_at) VALUES($1,$2,'test/manifest.json',now()-interval '1 minute')",
                [evidenceId, assetId],
            )
            await database.query("UPDATE analysis_video_assets SET state='ready',evidence_id=$1", [
                evidenceId,
            ])
            await expect(claimVideoEvidenceCleanup('cleanup', 60_000)).resolves.toBeNull()
            await database.exec("UPDATE analysis_tasks SET status='succeeded'")
            await expect(claimVideoEvidenceCleanup('cleanup', 60_000)).resolves.toEqual({
                evidenceId,
                objectPaths: ['test/manifest.json'],
            })
        },
    )
})
