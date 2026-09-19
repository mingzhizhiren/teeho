import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'
import type { DatabaseExecutor } from '../../db/database'

import { analysisUploadConstraints } from '../analysis.constants'
import {
    assertReadyMediaBinding,
    reuseReadyMediaAssetsForCheckup,
} from './analysis.media.repository'

function rows(count: number, declaredByteSize: number) {
    return Array.from({ length: count }, (_, index) => ({
        id: `asset-${index}`,
        taskId: null,
        declaredByteSize,
    }))
}

describe('analysis media task binding limits', () => {
    it('再次体检仅转挂当前账号仍有效且未进入清理的素材，不续期；缺少素材时拒绝', async () => {
        const execute = vi.fn().mockResolvedValue([{ id: 'asset' }])
        const database = { execute } as unknown as DatabaseExecutor
        await reuseReadyMediaAssetsForCheckup(database, 'new-task', 'user', ['asset'])
        const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0])
        expect(query.sql).toMatch(/SET task_id =/u)
        expect(query.sql).toMatch(/asset\.user_id =/u)
        expect(query.sql).toMatch(/asset\.expires_at > now\(\)/u)
        expect(query.sql).toMatch(/asset\.cleanup_requested_at IS NULL/u)
        expect(query.sql.split('WHERE')[0]).not.toContain('expires_at')
        expect(query.params).toEqual(['new-task', 'user', 'asset'])
        execute.mockResolvedValue([])
        await expect(
            reuseReadyMediaAssetsForCheckup(database, 'new-task', 'user', ['asset']),
        ).rejects.toMatchObject({ reason: 'analysis_asset_expired' })
    })
    it('accepts an ordered selection at the exact 80 MiB boundary', () => {
        const assets = rows(
            analysisUploadConstraints.maxFiles - 2,
            analysisUploadConstraints.maxFileBytes,
        )

        expect(() =>
            assertReadyMediaBinding(
                'task-id',
                assets.map((asset) => asset.id),
                assets,
            ),
        ).not.toThrow()
    })

    it('rejects assets split across upload sessions when their combined size exceeds 80 MiB', () => {
        const assets = rows(
            analysisUploadConstraints.maxFiles - 1,
            analysisUploadConstraints.maxFileBytes,
        )

        expect(() =>
            assertReadyMediaBinding(
                'task-id',
                assets.map((asset) => asset.id),
                assets,
            ),
        ).toThrow('图片总量超过限制')
    })
})
