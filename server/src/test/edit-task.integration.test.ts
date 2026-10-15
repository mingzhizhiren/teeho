import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { Elysia } from 'elysia'
import type { SQL } from 'drizzle-orm'
import type { PGlite } from '@electric-sql/pglite'
import type { DatabaseExecutor, DatabaseTransaction } from '../db/database'
import { createCommunityDatabase } from '../../../supabase/tests/community-database'
import {
    communityTaskFixture,
    communityReportFixture,
    communityTraceFixture,
    communityUserId,
    otherCommunityUserId,
} from './community-task.fixture'

const connection = vi.hoisted(() => ({ database: null as unknown as PGlite }))
const storage = vi.hoisted(() => ({
    createSignedUrl: vi.fn(async () => ({
        data: { signedUrl: 'https://storage.test/preview?token=synthetic' },
        error: null as { code: string; message: string; status: number } | null,
    })),
}))
vi.mock('../auth/auth.service', () => ({
    getCurrentUser: async (token: string) => ({
        success: true,
        data: {
            id:
                token === 'other-user'
                    ? '00000000-0000-4000-8000-000000000102'
                    : '00000000-0000-4000-8000-000000000101',
            email: 'synthetic@example.test',
        },
    }),
}))
vi.mock('../config/env', async (importOriginal) => {
    const original = await importOriginal<typeof import('../config/env')>()
    return {
        ...original,
        env: { ...original.env, SUPABASE_SECRET_KEY: 'synthetic-preview-test-key' },
    }
})
vi.mock('@supabase/supabase-js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@supabase/supabase-js')>()),
    createClient: () => ({ storage: { from: () => storage } }),
}))
vi.mock('../db/database', () => ({
    db: { execute: (statement: SQL) => executorFor(connection.database).execute(statement) },
    withTransaction: <T>(run: (executor: DatabaseTransaction) => Promise<T>) =>
        connection.database.transaction((client) =>
            run(executorFor(client) as DatabaseTransaction),
        ),
}))

import { createResearchingAnalysisTask } from '../analysis/tasks/analysis.task.service'
import {
    findAnalysisTaskById,
    insertResearchingAnalysisTask,
} from '../analysis/tasks/analysis.task.repository'
import {
    findOwnedMediaAssets,
    insertMediaUploadSession,
} from '../analysis/media/analysis.media.repository'
import { analysisFingerprintConstraints } from '../analysis/analysis.fingerprints.constants'
import { insertAnalysisResult } from '../analysis/tasks/analysis.result.repository'
import { analysisRoutes } from '../analysis/http/analysis.routes'
import { errorMiddleware } from '../middleware/error'
import { logger } from '../utils/logger'

const app = new Elysia({ prefix: '/api' }).use(errorMiddleware).use(analysisRoutes)

const sourceTaskId = '00000000-0000-4000-8000-000000000110'
const targetTaskId = '00000000-0000-4000-8000-000000000111'
const firstAssetId = '00000000-0000-4000-8000-000000000112'
const secondAssetId = '00000000-0000-4000-8000-000000000113'
let expiresAt: string
const fingerprints = {
    schemaVersion: analysisFingerprintConstraints.fingerprintVersion,
    quantification: '1'.repeat(64),
    level: '2'.repeat(64),
    generation: '3'.repeat(64),
}

/** 只替换外部连接，真实受理、事务、SQL及迁移均参与测试。 */
function executorFor(client: Pick<PGlite, 'query'>): DatabaseExecutor {
    return {
        async execute(statement: SQL) {
            const query = new PgDialect().sqlToQuery(statement)
            return (await client.query(query.sql, query.params)).rows
        },
    } as DatabaseExecutor
}

async function seed(): Promise<void> {
    const db = connection.database
    expiresAt = new Date(Date.now() + 3_600_000).toISOString()
    await db.query('INSERT INTO auth.users (id) VALUES ($1), ($2)', [
        communityUserId,
        otherCommunityUserId,
    ])
    const executor = executorFor(db)
    await insertResearchingAnalysisTask(executor, {
        taskId: sourceTaskId,
        userId: communityUserId,
        inputMode: 'custom',
        inputFingerprint: 'a'.repeat(64),
        fingerprints,
        standardTask: communityTaskFixture(),
        webResearchEnabled: false,
    })
    await db.query(
        "UPDATE public.analysis_tasks SET status = 'succeeded', attempt_count = 1, started_at = now(), completed_at = now() WHERE id = $1",
        [sourceTaskId],
    )
    await insertAnalysisResult(executor, {
        taskId: sourceTaskId,
        userId: communityUserId,
        resultVersion: 1,
        result: communityReportFixture(),
        trace: communityTraceFixture(),
    })
    await insertMediaUploadSession(executor, {
        sessionId: '00000000-0000-4000-8000-000000000120',
        userId: communityUserId,
        totalBytes: 2048,
        uploadExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        assetExpiresAt: expiresAt,
        assets: [firstAssetId, secondAssetId].map((id, position) => ({
            id,
            position,
            fileName: `${position}.jpg`,
            declaredMediaType: 'image/jpeg',
            declaredByteSize: 1024,
            originalObjectPath: `synthetic/original/${id}`,
        })),
    })
    await db.query(
        "UPDATE public.analysis_assets SET state = 'ready', task_id = $1, processed_object_path = 'derived/' || id, media_type = 'image/jpeg', byte_size = 512, width = 20, height = 20, sha256 = repeat('a', 64), original_sha256 = repeat('b', 64), ready_at = now()",
        [sourceTaskId],
    )
}

function submit(
    assetIds = [secondAssetId, firstAssetId],
    userId = communityUserId,
): Promise<string> {
    const original = communityTaskFixture()
    return createResearchingAnalysisTask({
        taskId: targetTaskId,
        userId,
        inputMode: 'custom',
        inputFingerprint: 'b'.repeat(64),
        fingerprints,
        assetIds,
        standardTask: {
            ...original,
            imageReferences: assetIds,
            coverReference: assetIds[0]!,
            fields: { ...original.fields, title: { value: '修改后的原稿', source: 'user_input' } },
        },
    })
}

async function additionalAssets(count: number, bytes: number): Promise<string[]> {
    const ids = Array.from(
        { length: count },
        (_, index) => `00000000-0000-4000-8000-${String(200 + index).padStart(12, '0')}`,
    )
    const executor = executorFor(connection.database)
    for (let offset = 0; offset < count; offset += 8) {
        const selected = ids.slice(offset, offset + 8)
        await insertMediaUploadSession(executor, {
            sessionId: `00000000-0000-4000-8000-${String(300 + offset).padStart(12, '0')}`,
            userId: communityUserId,
            totalBytes: selected.length * bytes,
            uploadExpiresAt: new Date(Date.now() + 60_000).toISOString(),
            assetExpiresAt: expiresAt,
            assets: selected.map((id, position) => ({
                id,
                position,
                fileName: `${id}.jpg`,
                declaredMediaType: 'image/jpeg',
                declaredByteSize: bytes,
                originalObjectPath: `synthetic/${id}`,
            })),
        })
    }
    await connection.database.query(
        "UPDATE public.analysis_assets SET state = 'ready', processed_object_path = 'derived/' || id, media_type = 'image/jpeg', byte_size = 512, width = 20, height = 20, sha256 = repeat('a', 64), original_sha256 = repeat('b', 64), ready_at = now() WHERE task_id IS NULL",
    )
    return ids
}

beforeEach(async () => {
    connection.database = await createCommunityDatabase()
    await seed()
}, 30_000)
afterEach(async () => {
    vi.restoreAllMocks()
    await connection.database?.close()
})

describe('再次编辑后的真实任务受理', () => {
    it('Storage 故障返回安全服务错误，客户端和日志均不暴露对象私有路径', async () => {
        const logError = vi.spyOn(logger, 'error')
        storage.createSignedUrl.mockResolvedValueOnce({
            data: { signedUrl: '' },
            error: Object.assign(new Error('synthetic private object path'), {
                code: 'InternalError',
                status: 500,
            }),
        })
        const response = await app.handle(
            new Request(`http://localhost/api/analysis/media/${firstAssetId}/preview`, {
                headers: { cookie: 'teeho_access_token=owner' },
            }),
        )

        expect(response.status).toBe(500)
        expect(await response.json()).toMatchObject({ message: '服务器内部错误' })
        const logged = JSON.stringify(logError.mock.calls, (_key, value: unknown) =>
            value instanceof Error ? { name: value.name, message: value.message } : value,
        )
        expect(logged).not.toContain('synthetic private object path')
    })
    it('数据库仍有记录但预览对象已物理删除时返回素材不可用', async () => {
        storage.createSignedUrl.mockResolvedValueOnce({
            data: { signedUrl: '' },
            error: {
                code: 'NoSuchKey',
                status: 404,
                message: 'synthetic private object path',
            },
        })
        const response = await app.handle(
            new Request(`http://localhost/api/analysis/media/${firstAssetId}/preview`, {
                headers: { cookie: 'teeho_access_token=owner' },
            }),
        )

        expect(response.status).toBe(410)
        expect(await response.json()).toMatchObject({
            data: { reason: 'analysis_asset_expired' },
        })
    })
    it('素材状态的数据库故障返回安全服务错误，不伪装成素材已删除', async () => {
        vi.spyOn(connection.database, 'query').mockRejectedValueOnce(
            Object.assign(new Error('synthetic database unavailable'), {
                query: 'synthetic sensitive query',
                params: ['synthetic sensitive parameter'],
            }),
        )
        const response = await app.handle(
            new Request('http://localhost/api/analysis/media/statuses', {
                method: 'POST',
                headers: {
                    cookie: 'teeho_access_token=owner',
                    'content-type': 'application/json',
                },
                body: JSON.stringify({ assetIds: [firstAssetId] }),
            }),
        )

        expect(response.status).toBe(500)
        expect(await response.json()).toMatchObject({
            message: '服务器内部错误',
            data: null,
        })
    })
    it.each(['other_owner', 'missing', 'duplicate', 'cleanup', 'expired', 'active'] as const)(
        '%s 素材不可复用时整次受理回滚，已有效素材不被部分转挂',
        async (reason) => {
            const db = connection.database
            if (reason === 'cleanup')
                await db.query(
                    'UPDATE public.analysis_assets SET cleanup_requested_at = now() WHERE id = $1',
                    [firstAssetId],
                )
            if (reason === 'expired')
                await db.query(
                    "UPDATE public.analysis_assets SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour', ready_at = now() - interval '90 minutes' WHERE id = $1",
                    [firstAssetId],
                )
            if (reason === 'active')
                await db.query(
                    "UPDATE public.analysis_tasks SET status = 'queued', attempt_count = 0, started_at = NULL, completed_at = NULL WHERE id = $1",
                    [sourceTaskId],
                )
            const ids =
                reason === 'missing'
                    ? [firstAssetId, '00000000-0000-4000-8000-000000000999']
                    : reason === 'duplicate'
                      ? [firstAssetId, firstAssetId]
                      : [secondAssetId, firstAssetId]
            const actor = reason === 'other_owner' ? otherCommunityUserId : communityUserId
            await expect(submit(ids, actor)).rejects.toThrow()
            expect(await findAnalysisTaskById(actor, targetTaskId)).toBeNull()
            expect((await findOwnedMediaAssets(communityUserId, [secondAssetId]))[0]?.taskId).toBe(
                sourceTaskId,
            )
        },
    )
    it('新旧素材组合仍按数据库原始大小限制80MiB，失败不留下新任务', async () => {
        const fresh = await additionalAssets(16, 5 * 1024 * 1024)
        await expect(submit([...fresh, firstAssetId, secondAssetId])).rejects.toThrow(
            '图片总量超过限制',
        )
        expect(await findAnalysisTaskById(communityUserId, targetTaskId)).toBeNull()
        expect((await findOwnedMediaAssets(communityUserId, [fresh[0]!]))[0]?.taskId).toBeNull()
    })
    it('分多个上传会话也不能组合超过18张素材', async () => {
        const fresh = await additionalAssets(17, 1024)
        await expect(submit([...fresh, firstAssetId, secondAssetId])).rejects.toThrow()
        expect(await findAnalysisTaskById(communityUserId, targetTaskId)).toBeNull()
        expect((await findOwnedMediaAssets(communityUserId, [fresh[0]!]))[0]?.taskId).toBeNull()
    })
    it('图片预览HTTP只向素材所属账号签发短时地址，拒绝未登录与其他账号', async () => {
        const url = `http://localhost/api/analysis/media/${firstAssetId}/preview`
        const response = await app.handle(
            new Request(url, { headers: { cookie: 'teeho_access_token=owner' } }),
        )
        expect(response.status).toBe(200)
        expect(response.headers.get('cache-control')).toBe('private, no-store')
        const body = await response.json()
        expect(body).toMatchObject({
            code: 0,
            data: {
                preview: {
                    assetId: firstAssetId,
                    previewUrl: 'https://storage.test/preview?token=synthetic',
                },
            },
        })
        expect(Date.parse(body.data.preview.previewExpiresAt)).toBeLessThanOrEqual(
            Date.parse(expiresAt),
        )
        expect(JSON.stringify(body)).not.toMatch(/originalObjectPath|processedObjectPath/)
        expect((await app.handle(new Request(url))).status).toBe(401)
        expect(
            (
                await app.handle(
                    new Request(url, { headers: { cookie: 'teeho_access_token=other-user' } }),
                )
            ).status,
        ).toBe(410)
    })
    it('复用有效旧图片并按新顺序绑定，不续期，不改变原任务，重复提交保持幂等', async () => {
        await expect(submit()).resolves.toBe(targetTaskId)
        await expect(submit()).resolves.toBe(targetTaskId)
        const assets = await findOwnedMediaAssets(communityUserId, [firstAssetId, secondAssetId])
        expect(assets.find((asset) => asset.id === secondAssetId)).toMatchObject({
            taskId: targetTaskId,
            position: 0,
            expiresAt,
        })
        expect(assets.find((asset) => asset.id === firstAssetId)).toMatchObject({
            taskId: targetTaskId,
            position: 1,
            expiresAt,
        })
        expect((await findAnalysisTaskById(communityUserId, sourceTaskId))?.status).toBe(
            'succeeded',
        )
        expect(
            (await findAnalysisTaskById(communityUserId, sourceTaskId))?.standardTask.fields.title
                .value,
        ).toBe('通勤防晒')
    })
})
