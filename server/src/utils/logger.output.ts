export type LoggerOutputMode = 'json-console' | 'formatted-console' | 'file' | 'console-and-file'

/** 根据日志目录和构建模式选择不会静默丢失生产日志的输出策略。 */
export function resolveLoggerOutputMode(
    logDirectory: string,
    debugEnabled: boolean,
): LoggerOutputMode {
    if (!logDirectory.trim()) {
        return debugEnabled ? 'formatted-console' : 'json-console'
    }
    return debugEnabled ? 'console-and-file' : 'file'
}
