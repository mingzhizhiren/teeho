import { beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '../../utils/logger'
import type { DatabaseTransaction } from '../../db/database'
import { requestAnalysisAssetCleanup } from './analysis.asset-lifecycle.repository'
import {
    cleanupAnalysisTaskAssets,
    cleanupAnalysisUserAssets,
    requestAnalysisTaskOriginalImageCleanupBestEffort,
    requestAnalysisUserAssetCleanupBestEffort,
} from './analysis.asset-lifecycle.service'

const transaction = vi.hoisted(() => ({ execute: vi.fn() }))
const withTransactionMock = vi.hoisted(() => vi.fn())
vi.mock('../../db/database', () => ({ withTransaction: withTransactionMock }))

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
        withTransactionMock.mockImplementation(
            (callback: (executor: DatabaseTransaction) => Promise<unknown>) =>
                callback(transaction as unknown as DatabaseTransaction),
        )
    })

    it('账号与任务清理都将锁定和登记放在同一事务', async () => {
        vi.mocked(requestAnalysisAssetCleanup).mockResolvedValue(2)
        await expect(cleanupAnalysisTaskAssets('user-id', 'task-id')).resolves.toEqual({
            requested: 2,
        })
        await expect(cleanupAnalysisUserAssets('user-id')).resolves.toEqual({ requested: 2 })
        expect(requestAnalysisAssetCleanup).toHaveBeenNthCalledWith(
            1,
            { userId: 'user-id', taskId: 'task-id' },
            transaction,
        )
        expect(requestAnalysisAssetCleanup).toHaveBeenNthCalledWith(
            2,
            { userId: 'user-id' },
            transaction,
        )
        expect(withTransactionMock).toHaveBeenCalledTimes(2)
    })

    it('不等待账号素材清理登记完成', () => {
        vi.mocked(requestAnalysisAssetCleanup).mockImplementation(
            () => new Promise<never>(() => undefined),
        )

        expect(requestAnalysisUserAssetCleanupBestEffort('user-id')).toBeUndefined()
        expect(requestAnalysisAssetCleanup).toHaveBeenCalledWith({ userId: 'user-id' }, transaction)
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
