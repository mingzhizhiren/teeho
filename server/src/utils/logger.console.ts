import { Writable } from 'node:stream'

const consoleFieldNames = [
    'event',
    'requestId',
    'method',
    'path',
    'status',
    'durationMs',
    'taskId',
    'correlationId',
    'assetId',
    'evidenceId',
    'workerId',
    'resultVersion',
    'attemptNumber',
    'contractVersion',
    'state',
    'stage',
    'declaredMediaType',
    'declaredByteSize',
    'verifiedMediaType',
    'verifiedByteSize',
    'queuePosition',
    'frameCount',
    'mediaDurationMs',
    'mediaWidth',
    'mediaHeight',
    'videoCodec',
    'hasAudio',
    'objectFound',
    'sizeMatches',
    'mediaTypeMatches',
    'httpStatus',
    'responseBodyLength',
    'previousUploadCount',
    'resumed',
    'errorName',
    'errorCode',
    'failureKind',
    'failureOutcome',
    'pollIntervalMs',
    'heartbeatIntervalMs',
    'processingTimeoutMs',
    'uploadLifetimeMs',
    'h264Available',
    'hevcAvailable',
    'errorCategory',
    'diagnosticMessage',
    'validationFieldPaths',
    'ruleId',
    'port',
    'protocol',
    'signal',
    'authCode',
    'operation',
    'provider',
    'retryDecision',
    'databaseCode',
    'databaseSchema',
    'databaseTable',
    'databaseConstraint',
    'databaseRoutine',
] as const

const pinoLevelNames: Record<number, string> = {
    10: 'TRACE',
    20: 'DEBUG',
    30: 'INFO',
    40: 'WARN',
    50: 'ERROR',
    60: 'FATAL',
}

const consoleDetailMaxLength = 80

const agentUsageStageNames: Record<string, string> = {
    form_conversation_turn: '聊天理解',
    collect_web_research: '联网资料搜集',
    generate_result: '生成分析结果',
    repair_agent_output: '修复分析输出',
}

const agentUsageStatusNames: Record<string, string> = {
    succeeded: '成功',
    technical_failed: '技术失败',
    cancelled: '已取消',
}

/** 判断未知值是否为普通日志对象 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 将控制台字段压缩为不会换行的单行文本 */
function formatConsoleValue(value: unknown) {
    if (typeof value === 'string') {
        return value.replace(/\s+/gu, ' ').trim()
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value)
    }
    if (
        Array.isArray(value) &&
        value.every((item) => typeof item === 'string' || typeof item === 'number')
    ) {
        return value.map(String).join(',')
    }
    return null
}

/** 截断可能由 Provider 配置产生的超长调试标签。 */
function formatConsoleDetail(value: unknown) {
    const formatted = formatConsoleValue(value)
    if (formatted === null || formatted.length <= consoleDetailMaxLength) {
        return formatted
    }
    return `${formatted.slice(0, consoleDetailMaxLength - 1)}…`
}

/** 格式化可空 Token 数量。 */
function formatTokenCount(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value)
        ? String(Math.max(0, Math.trunc(value)))
        : '未返回'
}

/** 把单次 Agent 调用展开为便于调试的短行信息块。 */
function formatAgentUsageLog(prefix: string, message: string, value: Record<string, unknown>) {
    const detail = value.agentUsage
    if (!isRecord(detail)) {
        return null
    }
    const usage = isRecord(detail.usage) ? detail.usage : {}
    const associationKind = formatConsoleDetail(detail.associationKind) ?? 'unknown'
    const associationId = formatConsoleDetail(detail.associationId) ?? 'unknown'
    const requestId = formatConsoleDetail(detail.requestId) ?? 'unknown'
    const executionId = formatConsoleDetail(detail.executionId) ?? '未返回'
    const stage = formatConsoleDetail(detail.stage) ?? 'unknown'
    const attemptNumber = formatConsoleDetail(detail.attemptNumber) ?? 'unknown'
    const status = formatConsoleDetail(detail.status) ?? 'unknown'
    const errorCategory = formatConsoleDetail(detail.errorCategory)
    const validationFieldPaths = formatConsoleDetail(value.validationFieldPaths)
    const ruleId = formatConsoleDetail(value.ruleId)
    const providerDebug = isRecord(value.providerDebug) ? value.providerDebug : null
    const outputKind = formatConsoleDetail(providerDebug?.outputKind)
    const outputCharacterCount = formatConsoleDetail(providerDebug?.outputCharacterCount)
    const outputSha256 = formatConsoleDetail(providerDebug?.outputSha256)
    const validationStage = formatConsoleDetail(providerDebug?.stage)
    const provider = formatConsoleDetail(detail.provider) ?? 'unknown'
    const model = formatConsoleDetail(detail.model) ?? '未配置'
    const providerVersion = formatConsoleDetail(detail.providerVersion) ?? 'unknown'
    const promptVersion = formatConsoleDetail(detail.promptVersion) ?? 'unknown'
    const retryScheduled = detail.retryScheduled === true ? '是' : '否'
    const stageName = agentUsageStageNames[stage] ?? stage
    const statusName = agentUsageStatusNames[status] ?? status

    return [
        `${prefix} ${message}`,
        `  归属: ${associationKind} ${associationId}`,
        `  阶段: ${stageName} (${stage}) | 第 ${attemptNumber} 次`,
        `  状态: ${statusName} (${status})`,
        ...(errorCategory ? [`  错误: ${errorCategory} | 将重试 ${retryScheduled}`] : []),
        ...(validationFieldPaths ? [`  字段: ${validationFieldPaths}`] : []),
        ...(ruleId ? [`  规则: ${ruleId}`] : []),
        ...(validationStage ? [`  校验阶段: ${validationStage}`] : []),
        ...(outputKind
            ? [
                  `  输出摘要: ${outputKind} | 字符 ${outputCharacterCount ?? '未知'} | SHA-256 ${outputSha256 ?? '未知'}`,
              ]
            : []),
        `  Provider: ${provider}`,
        `  模型: ${model}`,
        `  Provider 版本: ${providerVersion}`,
        `  Prompt 版本: ${promptVersion}`,
        `  素材: 图片 ${formatTokenCount(detail.imageInputCount)} | 视频帧 ${formatTokenCount(detail.videoFrameInputCount)}`,
        '  Token:',
        `    输入 ${formatTokenCount(usage.inputTokens)} | 文本 ${formatTokenCount(usage.textInputTokens)} | 图片 ${formatTokenCount(usage.imageInputTokens)}`,
        `    缓存输入 ${formatTokenCount(usage.cachedInputTokens)} | 推理 ${formatTokenCount(usage.reasoningTokens)} | 输出 ${formatTokenCount(usage.outputTokens)}`,
        `    Provider 总计 ${formatTokenCount(usage.totalTokens)} | 实际计量 ${formatTokenCount(detail.meteredTokens)}`,
        `  耗时: ${formatTokenCount(detail.durationMs)} ms | 将重试 ${retryScheduled}`,
        `  请求: ${requestId}`,
        `  执行: ${executionId}`,
    ].join('\n')
}

/** 将 Pino JSON 日志格式化为面向开发者的精简控制台文本 */
export function formatConsoleLog(value: unknown) {
    if (!isRecord(value)) {
        return '[LOG] 无法解析日志内容'
    }

    const time = formatConsoleValue(value.time)
    const level = typeof value.level === 'number' ? (pinoLevelNames[value.level] ?? 'LOG') : 'LOG'
    const message = formatConsoleValue(value.msg) ?? '无日志消息'
    const prefix = time ? `[${time}] ${level}` : level
    const agentUsageLog = formatAgentUsageLog(prefix, message, value)
    if (agentUsageLog) {
        return agentUsageLog
    }
    const fields = consoleFieldNames.flatMap((fieldName) => {
        const fieldValue = formatConsoleValue(value[fieldName])
        return fieldValue === null ? [] : [`${fieldName}=${fieldValue}`]
    })
    const errorMessage = isRecord(value.err) ? formatConsoleValue(value.err.message) : null
    if (errorMessage) {
        fields.push(`error=${errorMessage}`)
    }
    const providerDetail = isRecord(value.providerDebug)
        ? formatConsoleValue(value.providerDebug.message)
        : null
    if (providerDetail) {
        fields.push(`providerDetail=${providerDetail}`)
    }
    const executionDetail = isRecord(value.executionDebug)
        ? formatConsoleValue(value.executionDebug.message)
        : null
    if (executionDetail) {
        fields.push(`executionDetail=${executionDetail}`)
    }

    return [prefix, message, ...fields].join(' ')
}

/** 创建只向 stdout 写入精简文本的调试控制台流 */
export function createConsoleLogStream() {
    return new Writable({
        write(chunk, _encoding, callback) {
            const lines = chunk.toString().split(/\r?\n/u).filter(Boolean)
            for (const line of lines) {
                try {
                    process.stdout.write(`${formatConsoleLog(JSON.parse(line) as unknown)}\n`)
                } catch {
                    process.stdout.write('[LOG] 无法解析日志内容\n')
                }
            }
            callback()
        },
    })
}
