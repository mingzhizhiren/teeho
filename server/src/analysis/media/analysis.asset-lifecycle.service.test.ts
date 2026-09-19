import { beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '../../utils/logger'
import { requestAnalysisAssetCleanup } from './analysis.asset-lifecycle.repository'
import {
    requestAnalysisTaskOriginalImageCleanupBestEffort,
    requestAnalysisUserAssetCleanupBestEffort,
} from './analysis.asset-lifecycle.service'

vi.mock('../../utils/logger', () => ({
    logger: {
        debug: vi.fn(),
        warn: vi.fn(),
    },
}))

vi.mock('./analysis.asset-lifecycle.repository', () => ({
    findAnalysisTaskOriginalObjectPaths: vi.fn(),
    invokeAnalysisMediaCleanup: vi.fn(),
    requestAnalysisAssetCleanup: vi.fn(),
}))

describe('analysis asset lifecycle service', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('不等待账号素材清理登记完成', () => {
        vi.mocked(requestAnalysisAssetCleanup).mockImplementation(
            () => new Promise<never>(() => undefined),
        )

        expect(requestAnalysisUserAssetCleanupBestEffort('user-id')).toBeUndefined()
        expect(requestAnalysisAssetCleanup).toHaveBeenCalledWith({ userId: 'user-id' })
    })

    it('后台登记失败只记录日志，不产生未处理 Promise', async () => {
        vi.mocked(requestAnalysisAssetCleanup).mockRejectedValue(new Error('database unavailable'))

        requestAnalysisUserAssetCleanupBestEffort('user-id')
        await vi.waitFor(() => {
            expect(logger.warn).toHaveBeenCalledWith(
                expect.objectContaining({
                    event: 'analysis_user_asset_cleanup_request_failed',
                }),
                expect.any(String),
            )
        })
    })

    it('任务成功后异步删除去重后的原图且不阻塞完成响应', async () => {
        const findPaths = vi.fn(async () => ['one/original.jpg', 'one/original.jpg'])
        const remove = vi.fn(async () => undefined)

        expect(
            requestAnalysisTaskOriginalImageCleanupBestEffort('user-id', 'task-id', {
                findPaths,
                remove,
                log: logger,
            }),
        ).toBeUndefined()
        await vi.waitFor(() => {
            expect(remove).toHaveBeenCalledWith(['one/original.jpg'])
        })
    })
})
