import { createApplication } from './app.composition'
import { recoverInterruptedConversations } from './analysis/conversation/analysis.conversation-startup.service'
import { env } from './config/env'
import { createListenOptions } from './config/server'
import { closeDatabaseConnection } from './db/database'
import { flushLogs, logger } from '@teeho/community-server/utils/logger'

interface StoppableApplication {
    app: {
        readonly server: unknown
        stop(): unknown
    }
    worker: { stop(): Promise<void> }
    mediaWorker: { stop(): void }
    workspaceEventListener: { stop(): Promise<void> }
    dispose(): void
}

/** 清理完整或部分启动的应用资源。 */
export async function stopApplication(
    application: StoppableApplication,
    closeDatabase: () => Promise<void> = closeDatabaseConnection,
) {
    if (application.app.server) {
        application.app.stop()
    }
    await application.worker.stop()
    application.mediaWorker.stop()
    await application.workspaceEventListener.stop()
    application.dispose()
    await closeDatabase()
}

/** 启动题火 API 进程；只有该入口负责监听、后台工作与信号处理。 */
async function startServer() {
    const application = await createApplication()
    let shutdownPromise: Promise<void> | undefined

    /** 停止后台任务并关闭 HTTP 服务 */
    const shutdown = (signal: string) => {
        shutdownPromise ??= (async () => {
            logger.info({ event: 'server_stopping', signal }, '服务器正在停止')
            await stopApplication(application, closeDatabaseConnection)
            logger.info({ event: 'server_stopped' }, '服务器已停止')
        })()
            .catch((error: unknown) => {
                process.exitCode = 1
                logger.error(
                    { event: 'server_shutdown_failed', err: error, signal },
                    '服务器停止失败',
                )
            })
            .finally(() => {
                flushLogs()
            })

        return shutdownPromise
    }

    process.once('uncaughtException', (error) => {
        process.exitCode = 1
        logger.fatal({ event: 'process_uncaught_exception', err: error }, '进程发生未捕获异常')
        void shutdown('uncaughtException')
    })
    process.once('unhandledRejection', (reason) => {
        process.exitCode = 1
        logger.fatal(
            { event: 'process_unhandled_rejection', err: reason },
            '进程发生未处理的 Promise 拒绝',
        )
        void shutdown('unhandledRejection')
    })

    logger.info(
        { event: 'server_starting', mode: !DEBUG ? 'release' : 'debug', cwd: process.cwd() },
        '服务器正在启动',
    )
    const { options, protocol } = createListenOptions()
    try {
        await recoverInterruptedConversations()
    } catch (error) {
        logger.error(
            { event: 'analysis_conversation_startup_recovery_failed', err: error },
            '聊天启动恢复失败，停止开放接口',
        )
        await stopApplication(application, closeDatabaseConnection)
        throw error
    }
    await application.workspaceEventListener.start()
    application.app.listen(options)
    application.worker.start()
    application.mediaWorker.start()
    process.once('SIGINT', () => void shutdown('SIGINT'))
    process.once('SIGTERM', () => void shutdown('SIGTERM'))
    logger.info({ event: 'server_started', port: env.PORT, protocol }, '服务器启动成功')
}

if (import.meta.main) {
    await startServer()
}

export { createApplication } from './app.composition'
