import path from 'node:path'

import pino from 'pino'

import { env } from '../config/env'
import { getRequestObservabilityContext } from '../observability/request-context'
import { createConsoleLogStream } from './logger.console'
import { resolveLoggerOutputMode } from './logger.output'

const logFileName = 'server.log'
const redactedValue = '[REDACTED]'

/** 日志目录：绝对路径直接使用，否则按进程 cwd 解析 */
function resolveLogDirectory(directory: string) {
    return path.isAbsolute(directory) ? directory : path.resolve(process.cwd(), directory)
}

/** 创建每日滚动的结构化 JSON 文件传输 */
function createFileTransport(absoluteDirectory: string) {
    const logLevel = env.LOG_LEVEL ?? 'info'
    const transport = pino.transport({
        target: 'pino-roll',
        level: logLevel,
        options: {
            file: path.join(absoluteDirectory, logFileName),
            frequency: 'daily',
            dateFormat: 'yyyy-MM-dd',
            mkdir: true,
            limit: {
                count: env.LOG_FILE_RETENTION_DAYS,
            },
        },
    })
    transport.on('error', (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        process.stderr.write(`日志传输失败: ${message}\n`)
    })
    return transport
}

/** 创建绑定服务信息和日志级别的日志器 */
function createLogger() {
    const logDirectory = env.LOG_FILE_DIR?.trim() ?? ''
    const debugEnabled = typeof DEBUG !== 'undefined' && DEBUG
    const outputMode = resolveLoggerOutputMode(logDirectory, debugEnabled)
    const logLevel = env.LOG_LEVEL ?? 'info'
    const options: pino.LoggerOptions = {
        level: logLevel,
        base: {
            pid: process.pid,
            service: 'teeho-api',
            environment: env.NODE_ENV,
        },
        timestamp: pino.stdTimeFunctions.isoTime,
        mixin() {
            const context = getRequestObservabilityContext()
            return context ? { requestId: context.requestId } : {}
        },
        redact: {
            paths: [
                'password',
                '*.password',
                'accessToken',
                '*.accessToken',
                'refreshToken',
                '*.refreshToken',
                'authorization',
                '*.authorization',
                'cookie',
                '*.cookie',
                'req.headers.authorization',
                'req.headers.cookie',
            ],
            censor: redactedValue,
        },
    }

    if ((env.NODE_ENV === 'test' || process.env.NODE_ENV === 'test') && !logDirectory) {
        return pino({ ...options, enabled: false })
    }

    if (outputMode === 'json-console') {
        return pino(options)
    }
    if (outputMode === 'formatted-console') {
        return pino(options, createConsoleLogStream())
    }

    const fileTransport = createFileTransport(resolveLogDirectory(logDirectory))
    if (outputMode === 'file') {
        return pino(options, fileTransport)
    }

    return pino(
        options,
        pino.multistream([
            {
                level: logLevel,
                stream: createConsoleLogStream(),
            },
            {
                level: logLevel,
                stream: fileTransport,
            },
        ]),
    )
}

/** 全局 Pino 日志实例；发布构建仅写文件，调试构建额外输出精简控制台日志 */
export const logger = createLogger()

/** 立即刷新日志缓冲区，供进程异常退出和优雅停止使用 */
export function flushLogs() {
    logger.flush()
}
