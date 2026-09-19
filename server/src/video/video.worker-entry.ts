import { closeDatabaseConnection } from '../db/database'
import { flushLogs, logger } from '../utils/logger'
import { VideoPreprocessingWorker } from './video.worker'

/** 视频 Worker 独立进程入口；与 API 共用同一 server 包和部署制品。 */
export async function startVideoWorker() {
    const videoWorkerLogger = logger.child({ service: 'teeho-video-worker' })
    const worker = new VideoPreprocessingWorker({ log: videoWorkerLogger })
    let shutdownPromise: Promise<void> | undefined
    const shutdown = (signal: string) => {
        shutdownPromise ??= (async () => {
            videoWorkerLogger.info(
                { event: 'video_worker_stopping', signal },
                '视频 Worker 正在停止',
            )
            await worker.stop()
            await closeDatabaseConnection()
            videoWorkerLogger.info({ event: 'video_worker_stopped' }, '视频 Worker 已停止')
        })()
            .catch((error: unknown) => {
                process.exitCode = 1
                videoWorkerLogger.error(
                    { event: 'video_worker_shutdown_failed', err: error, signal },
                    '视频 Worker 停止失败',
                )
            })
            .finally(() => flushLogs())
        return shutdownPromise
    }

    process.once('uncaughtException', (error) => {
        process.exitCode = 1
        videoWorkerLogger.fatal(
            { event: 'video_worker_uncaught_exception', err: error },
            '视频 Worker 发生未捕获异常',
        )
        void shutdown('uncaughtException')
    })
    process.once('unhandledRejection', (reason) => {
        process.exitCode = 1
        videoWorkerLogger.fatal(
            { event: 'video_worker_unhandled_rejection', err: reason },
            '视频 Worker 发生未处理的 Promise 拒绝',
        )
        void shutdown('unhandledRejection')
    })
    process.once('SIGINT', () => void shutdown('SIGINT'))
    process.once('SIGTERM', () => void shutdown('SIGTERM'))

    await worker.start()
    videoWorkerLogger.info(
        { event: 'video_worker_started', pid: process.pid },
        '视频 Worker 已启动',
    )
}

if (import.meta.main) {
    await startVideoWorker()
}
