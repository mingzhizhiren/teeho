import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'

import { admitAnalysisMediaUpload } from './analysis.media-upload-admission.repository'

const userId = '00000000-0000-4000-8000-000000000001'

function queryAt(execute: ReturnType<typeof vi.fn>, position: number) {
    return new PgDialect().sqlToQuery(execute.mock.calls[position]![0])
}

describe('analysis media upload admission repository', () => {
    it('在账号事务锁内同时读取图片和视频的一分钟上传数量', async () => {
        const execute = vi
            .fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ imageCount: 49, videoCount: 5 }])

        await expect(
            admitAnalysisMediaUpload({ execute } as never, userId, { kind: 'image', count: 1 }),
        ).resolves.toEqual({ admitted: true })

        expect(queryAt(execute, 0).sql).toMatch(/pg_advisory_xact_lock/iu)
        const counts = queryAt(execute, 1)
        expect(counts.sql).toMatch(/analysis_assets/iu)
        expect(counts.sql).toMatch(/analysis_video_assets/iu)
        expect(counts.sql).toMatch(/interval '1 millisecond'/iu)
        expect(counts.params).toContain(userId)
    })

    it('超限时只作废未绑定任务的草稿素材并提交清理意图', async () => {
        const execute = vi
            .fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ imageCount: 50, videoCount: 0 }])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
                {
                    id: '00000000-0000-4000-8000-000000000002',
                    uploadSessionId: '00000000-0000-4000-8000-000000000003',
                },
            ])
            .mockResolvedValue([])

        await expect(
            admitAnalysisMediaUpload({ execute } as never, userId, { kind: 'image', count: 1 }),
        ).resolves.toEqual({ admitted: false, reason: 'image_limit' })

        expect(queryAt(execute, 2).sql).toMatch(
            /analysis_assets[\s\S]*cleanup_requested_at[\s\S]*task_id IS NULL/iu,
        )
        expect(queryAt(execute, 3).sql).toMatch(
            /analysis_video_assets[\s\S]*NOT EXISTS[\s\S]*analysis_tasks/iu,
        )
        expect(queryAt(execute, 4).sql).toMatch(
            /analysis_video_processing_attempts[\s\S]*state = 'cancelled'/iu,
        )
        expect(queryAt(execute, 5).sql).toMatch(
            /analysis_video_upload_sessions[\s\S]*state = 'cancelled'/iu,
        )
    })
})
