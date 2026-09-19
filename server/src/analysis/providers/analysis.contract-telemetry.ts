import { z } from 'zod'

import { logger } from '../../utils/logger'
import { agentProviderErrorLogFields } from './analysis.provider'

export const analysisContractVersions = {
    task: 'analysis-task.v6',
    evidence: 'analysis-evidence.v3',
    quantitativeReport: 'quantitative-report.v3',
    result: 'analysis-result.v6',
    executionTrace: 'execution-trace.v4',
} as const

export type AnalysisContractVersion =
    (typeof analysisContractVersions)[keyof typeof analysisContractVersions]
export type AnalysisContractLogger = Pick<typeof logger, 'debug'>
export type AnalysisContractSafeSummary = Record<string, string | number | boolean | null>

export interface AnalysisContractLogContext {
    requestId: string
    taskId: string
    resultVersion: number
    attemptNumber: number
}

interface TraceAnalysisContractOptions<T> extends AnalysisContractLogContext {
    log: AnalysisContractLogger
    contractVersion: AnalysisContractVersion
    run: () => T | Promise<T>
    summarize: (value: T) => AnalysisContractSafeSummary
}

function validationPaths(error: z.ZodError) {
    return [...new Set(error.issues.map((issue) => issue.path.join('.') || '$root'))]
}

function safeFailureFields(error: unknown) {
    if (error instanceof z.ZodError) {
        return {
            errorCategory: 'schema_validation',
            validationFieldPaths: validationPaths(error),
            ruleId: 'analysis-contract.schema-validation',
            errorName: error.name,
        }
    }
    const provider = agentProviderErrorLogFields(error, true)
    return {
        errorCategory: provider.errorCategory,
        validationFieldPaths: provider.validationFieldPaths,
        ruleId: provider.ruleId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
    }
}

function emitDebug(log: AnalysisContractLogger, fields: Record<string, unknown>, message: string) {
    try {
        log.debug(fields, message)
    } catch {
        // 可观测性永远不能改变分析主流程结果。
    }
}

/** 以统一结构记录一个分析契约阶段的开始、成功和失败。 */
export async function traceAnalysisContract<T>(
    options: TraceAnalysisContractOptions<T>,
): Promise<T> {
    const startedAt = Date.now()
    const common = {
        event: 'analysis_contract_stage',
        requestId: options.requestId,
        taskId: options.taskId,
        resultVersion: options.resultVersion,
        attemptNumber: options.attemptNumber,
        contractVersion: options.contractVersion,
    }
    emitDebug(options.log, { ...common, state: 'started' }, '分析契约阶段开始')
    let value: T
    try {
        value = await options.run()
    } catch (error) {
        emitDebug(
            options.log,
            {
                ...common,
                state: 'failed',
                durationMs: Date.now() - startedAt,
                ...safeFailureFields(error),
            },
            '分析契约阶段失败',
        )
        throw error
    }
    let summary: AnalysisContractSafeSummary = {}
    try {
        summary = options.summarize(value)
    } catch {
        summary = { telemetrySummaryFailed: true }
    }
    emitDebug(
        options.log,
        {
            ...common,
            state: 'completed',
            durationMs: Date.now() - startedAt,
            ...summary,
        },
        '分析契约阶段完成',
    )
    return value
}

/** 事务提交成功后记录结果契约已经持久化。 */
export function logAnalysisContractPersisted(
    log: AnalysisContractLogger,
    context: AnalysisContractLogContext,
    contractVersion: AnalysisContractVersion,
) {
    emitDebug(
        log,
        {
            event: 'analysis_contract_stage',
            ...context,
            contractVersion,
            state: 'persisted',
        },
        '分析契约已持久化',
    )
}
