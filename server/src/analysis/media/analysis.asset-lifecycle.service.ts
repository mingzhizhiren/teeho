import { logger } from '../../utils/logger'
import {
    findAnalysisTaskOriginalObjectPaths,
    invokeAnalysisMediaCleanup,
    requestAnalysisAssetCleanup,
} from './analysis.asset-lifecycle.repository'
import { supabaseAnalysisObjectStorage } from './analysis.storage'

/** 记录单个任务的素材清理意图，实际删除由 PostgreSQL 定时任务执行。 */
export async function cleanupAnalysisTaskAssets(userId: string, taskId: string) {
    const requested = await requestAnalysisAssetCleanup({ userId, taskId })
    return { requested }
}

/** 记录当前账号全部素材的清理意图，实际删除由 PostgreSQL 定时任务执行。 */
export async function cleanupAnalysisUserAssets(userId: string) {
    const requested = await requestAnalysisAssetCleanup({ userId })
    return { requested }
}

/** 在主请求之外尽力登记账号素材清理意图；过期定时任务仍是最终兜底。 */
export function requestAnalysisUserAssetCleanupBestEffort(userId: string) {
    void cleanupAnalysisUserAssets(userId)
        .then(({ requested }) => {
            logger.debug(
                {
                    event: 'analysis_user_asset_cleanup_requested',
                    requested,
                },
                '账号临时素材清理意图已登记',
            )
        })
        .catch((error: unknown) => {
            logger.warn(
                {
                    event: 'analysis_user_asset_cleanup_request_failed',
                    err: error,
                },
                '账号临时素材清理意图登记失败',
            )
        })
}

/** 尽力唤醒图片清理队列；失败仍由保留期定时任务兜底。 */
export function requestAnalysisMediaCleanupRunBestEffort() {
    void invokeAnalysisMediaCleanup().catch((error: unknown) => {
        logger.warn(
            {
                event: 'analysis_media_cleanup_dispatch_failed',
                err: error,
            },
            '分析图片清理队列唤醒失败',
        )
    })
}

interface OriginalImageCleanupDependencies {
    findPaths: typeof findAnalysisTaskOriginalObjectPaths
    remove: typeof supabaseAnalysisObjectStorage.remove
    log: Pick<typeof logger, 'debug' | 'warn'>
}

const originalImageCleanupDependencies: OriginalImageCleanupDependencies = {
    findPaths: findAnalysisTaskOriginalObjectPaths,
    remove: (paths) => supabaseAnalysisObjectStorage.remove(paths),
    log: logger,
}

/** 成功任务只异步删除用户原图；派生图和视频证据按既有短期策略保留。 */
export function requestAnalysisTaskOriginalImageCleanupBestEffort(
    userId: string,
    taskId: string,
    dependencies: OriginalImageCleanupDependencies = originalImageCleanupDependencies,
) {
    void dependencies
        .findPaths({ userId, taskId })
        .then(async (paths) => {
            const uniquePaths = [...new Set(paths)]
            await dependencies.remove(uniquePaths)
            dependencies.log.debug(
                {
                    event: 'analysis_task_original_images_deleted',
                    taskId,
                    deletedCount: uniquePaths.length,
                },
                '分析任务原始图片已删除',
            )
        })
        .catch((error: unknown) => {
            dependencies.log.warn(
                {
                    event: 'analysis_task_original_image_cleanup_failed',
                    taskId,
                    err: error,
                },
                '分析任务原始图片删除失败，将由保留期清理兜底',
            )
        })
}
