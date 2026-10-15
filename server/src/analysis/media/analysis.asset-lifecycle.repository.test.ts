import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseExecutor } from '../../db/database'

import {
    findAnalysisTaskOriginalObjectPaths,
    requestAnalysisAssetCleanup,
} from './analysis.asset-lifecycle.repository'

const databaseMocks = vi.hoisted(() => ({
    execute: vi.fn(),
}))

vi.mock('../../db/database', () => ({
    db: { execute: databaseMocks.execute },
}))

const userId = '00000000-0000-4000-8000-000000000001'
const taskId = '00000000-0000-4000-8000-000000000002'
const executor = { execute: databaseMocks.execute } as unknown as DatabaseExecutor

describe('analysis asset cleanup intent repository', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        databaseMocks.execute.mockResolvedValue([{ id: 'asset-1' }])
    })

    it('单任务接口只登记清理时间，不在题火进程中物理删除', async () => {
        await expect(requestAnalysisAssetCleanup({ userId, taskId }, executor)).resolves.toBe(1)

        const locked = new PgDialect().sqlToQuery(databaseMocks.execute.mock.calls[0]![0])
        expect(locked.sql).toMatch(/ORDER BY id\s+FOR UPDATE/iu)
        const query = new PgDialect().sqlToQuery(databaseMocks.execute.mock.calls[1]![0])
        expect(query.sql).toMatch(
            /UPDATE public\.analysis_assets AS asset\s+SET cleanup_requested_at/iu,
        )
        expect(query.sql).toMatch(/AND task_id = \$\d+::uuid/iu)
        expect(query.sql).toMatch(/state NOT IN \('deleted', 'deleting'\)/iu)
        expect(query.sql).not.toMatch(
            /\bDELETE\s+FROM\b|cleanup_attempt_count|cleanup_next_attempt_at|cleanup_last_error_code/iu,
        )
        expect(query.params).toEqual([userId, taskId, ['asset-1']])
    })

    it('只读取当前账号与任务绑定图片的原始对象键', async () => {
        databaseMocks.execute.mockResolvedValueOnce([
            { originalObjectPath: 'owner/session/original/image.jpg' },
        ])

        await expect(findAnalysisTaskOriginalObjectPaths({ userId, taskId })).resolves.toEqual([
            'owner/session/original/image.jpg',
        ])

        const query = new PgDialect().sqlToQuery(databaseMocks.execute.mock.calls[0]![0])
        expect(query.sql).toMatch(/SELECT original_object_path/iu)
        expect(query.sql).toMatch(/user_id = \$\d+::uuid/iu)
        expect(query.sql).toMatch(/task_id = \$\d+::uuid/iu)
        expect(query.params).toEqual([userId, taskId])
    })

    it('账号接口只登记该账号素材且不扩大清理范围', async () => {
        await expect(requestAnalysisAssetCleanup({ userId }, executor)).resolves.toBe(1)

        const query = new PgDialect().sqlToQuery(databaseMocks.execute.mock.calls[1]![0])
        expect(query.sql).toMatch(/WHERE user_id = \$\d+::uuid/iu)
        expect(query.sql).toMatch(/state NOT IN \('deleted', 'deleting'\)/iu)
        expect(query.sql).not.toMatch(/\bDELETE\s+FROM\b/iu)
        expect(query.sql).toMatch(/NOT EXISTS[\s\S]*task\.id = asset\.task_id/iu)
        expect(query.sql).toMatch(/'researching', 'queued', 'processing', 'retrying'/u)
        expect(query.params).toEqual([userId, ['asset-1']])
    })
})
