import { ZodError } from 'zod'

import { logger } from '../../utils/logger'
import { analysisWebResearchConstraints } from '../analysis.constants'
import { AnalysisTaskLeaseLostError } from '../analysis.errors'
import { agentPromptCatalog } from '../providers/analysis.prompt.constants'
import {
    AgentCancelledError,
    AgentProviderError,
    agentProviderErrorLogFields,
} from '../providers/analysis.provider'
import {
    agentUsageCallService,
    type AgentUsageCallService,
    type AgentUsageProviderDescriptor,
} from '../usage/analysis.agent-usage.service'
import type { WebResearchProvider } from './analysis.research-provider'
import {
    createWebResearchInput,
    createWebResearchQueryPlan,
    readWebResearchResult,
    type AnalysisWebResearchResult,
} from './analysis.web-research'
import {
    reserveWebResearchAttempt,
    type ClaimedWebResearchTask,
} from './analysis.web-research.repository'
import { completeWebResearchTask } from './analysis.web-research.service'

const noSourcesResult: AnalysisWebResearchResult = {
    status: 'no_sources',
    summary: null,
    keyFacts: [],
    conflicts: [],
    sources: [],
}

type WebResearchExecutionLogger = Pick<typeof logger, 'debug' | 'info' | 'warn'>

interface WebResearchResultLogContext {
    attemptNumber: number
    generationVersion: number
    requestId: string
    taskId: string
}

const validationIssueLogLimit = 20
const safeValidationPathNames = new Set([
    'status',
    'summary',
    'keyFacts',
    'conflicts',
    'sources',
    'text',
    'sourceUrls',
    'draftClaim',
    'externalFinding',
    'title',
    'site',
    'publishedAt',
    'url',
    'sourceType',
])

interface WebResearchResultShape {
    conflictCount: number | null
    factCount: number | null
    resultStatus: 'collected' | 'no_sources' | 'invalid'
    resultType: string
    sourceCount: number | null
}

function webResearchResultShape(value: unknown): WebResearchResultShape {
    const record =
        typeof value === 'object' && value !== null && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : null
    const count = (name: string) => {
        const candidate = record?.[name]
        return Array.isArray(candidate) ? candidate.length : null
    }
    const status = record?.status
    return {
        resultType: record ? 'object' : Array.isArray(value) ? 'array' : typeof value,
        resultStatus: status === 'collected' || status === 'no_sources' ? status : 'invalid',
        factCount: count('keyFacts'),
        conflictCount: count('conflicts'),
        sourceCount: count('sources'),
    }
}

function validationIssueDiagnostics(error: unknown) {
    if (!(error instanceof ZodError)) {
        return []
    }
    return error.issues.slice(0, validationIssueLogLimit).map((issue) => ({
        code: issue.code,
        path: issue.path
            .map((part) =>
                typeof part === 'number'
                    ? '[index]'
                    : safeValidationPathNames.has(part)
                      ? part
                      : '[field]',
            )
            .join('.'),
    }))
}

function droppedCount(before: number | null, after: number): number | null {
    return before === null ? null : Math.max(0, before - after)
}

function createWebResearchResultParser(
    log: WebResearchExecutionLogger,
    context: WebResearchResultLogContext,
) {
    return (value: unknown): AnalysisWebResearchResult => {
        const shape = webResearchResultShape(value)
        log.debug(
            { event: 'web_research_result_received', ...context, ...shape },
            '联网资料 Provider 结果已接收',
        )
        try {
            const result = readWebResearchResult(value)
            log.debug(
                {
                    event: 'web_research_result_normalized',
                    ...context,
                    researchStatus: result.status,
                    sourceCount: result.sources.length,
                    factCount: result.keyFacts.length,
                    conflictCount: result.conflicts.length,
                    droppedSourceCount: droppedCount(shape.sourceCount, result.sources.length),
                    droppedFactCount: droppedCount(shape.factCount, result.keyFacts.length),
                    droppedConflictCount: droppedCount(
                        shape.conflictCount,
                        result.conflicts.length,
                    ),
                },
                '联网资料 Provider 结果已规范化',
            )
            return result
        } catch (error) {
            log.warn(
                {
                    event: 'web_research_result_invalid',
                    ...context,
                    ...shape,
                    errorName: error instanceof Error ? error.constructor.name : 'UnknownError',
                    validationIssueCount: error instanceof ZodError ? error.issues.length : 0,
                    validationIssues: validationIssueDiagnostics(error),
                },
                '联网资料 Provider 结果校验失败',
            )
            throw error
        }
    }
}

function canRetryWebResearch(error: unknown, attempts: number) {
    return (
        attempts < analysisWebResearchConstraints.maxAttempts &&
        (!(error instanceof AgentProviderError) || error.retryable)
    )
}

export interface WebResearchTaskExecutor {
    execute: (task: ClaimedWebResearchTask) => Promise<void>
    cancel: (taskId: string) => boolean
}

export interface WebResearchExecutionPersistence {
    complete: typeof completeWebResearchTask
    reserve: typeof reserveWebResearchAttempt
}

interface WebResearchExecutionClock {
    nowIso: () => string
}

export interface CreateWebResearchTaskExecutorOptions {
    provider: WebResearchProvider | null
    persistence?: WebResearchExecutionPersistence
    clock?: WebResearchExecutionClock
    log?: WebResearchExecutionLogger
    usage?: AgentUsageCallService
    providerDescriptor?: AgentUsageProviderDescriptor
}

const postgresWebResearchExecutionPersistence: WebResearchExecutionPersistence = {
    complete: completeWebResearchTask,
    reserve: reserveWebResearchAttempt,
}

/** 创建 fail-open 的正式分析前资料搜集执行器。 */
export function createWebResearchTaskExecutor(
    options: CreateWebResearchTaskExecutorOptions,
): WebResearchTaskExecutor {
    const provider = options.provider
    const persistence = options.persistence ?? postgresWebResearchExecutionPersistence
    const clock = options.clock ?? { nowIso: () => new Date().toISOString() }
    const log = options.log ?? logger
    const usage = options.usage ?? agentUsageCallService
    const providerDescriptor = options.providerDescriptor ?? {
        provider: 'mock' as const,
        model: null,
    }
    const running = new Map<string, AbortController>()

    return {
        async execute(task) {
            const controller = new AbortController()
            running.set(task.id, controller)
            try {
                let result = noSourcesResult
                const researchInput = createWebResearchInput(task.standardTask)
                const queryPlan = createWebResearchQueryPlan(researchInput)
                const requestId = crypto.randomUUID()
                let lastFailure: unknown = null
                let attempts = task.attemptCount
                let allocatedTokens = task.allocatedTokens

                log.debug(
                    {
                        event: 'web_research_dispatch_decision',
                        requestId,
                        taskId: task.id,
                        generationVersion: task.generationVersion,
                        provider: providerDescriptor.provider,
                        model: providerDescriptor.model,
                        providerAvailable: provider !== null,
                        queryCount: queryPlan.queries.length,
                        attemptCount: attempts,
                        allocatedTokens,
                        maxAttempts: analysisWebResearchConstraints.maxAttempts,
                        tokenBudget: analysisWebResearchConstraints.tokenBudget,
                        providerTotalTokenLimit:
                            analysisWebResearchConstraints.providerTotalTokenLimit,
                    },
                    '联网资料收集调度判定',
                )

                while (
                    provider &&
                    queryPlan.queries.length > 0 &&
                    attempts < analysisWebResearchConstraints.maxAttempts &&
                    allocatedTokens < analysisWebResearchConstraints.tokenBudget
                ) {
                    const reservation = await persistence.reserve(
                        task,
                        analysisWebResearchConstraints.tokenReservationPerAttempt,
                    )
                    if (!reservation) {
                        log.debug(
                            {
                                event: 'web_research_reservation_unavailable',
                                requestId,
                                taskId: task.id,
                                generationVersion: task.generationVersion,
                            },
                            '联网资料收集未取得 Token 预留',
                        )
                        break
                    }
                    attempts = reservation.attemptCount
                    allocatedTokens = reservation.allocatedTokens
                    log.debug(
                        {
                            event: 'web_research_attempt_started',
                            requestId,
                            taskId: task.id,
                            generationVersion: task.generationVersion,
                            attemptNumber: attempts,
                            allocatedTokens,
                            queryCount: queryPlan.queries.length,
                        },
                        '联网资料收集开始',
                    )
                    try {
                        const tracked = await usage.execute({
                            userId: task.userId,
                            association: { kind: 'task', id: task.id },
                            requestId,
                            stage: 'collect_web_research',
                            provider: providerDescriptor,
                            promptVersion: agentPromptCatalog.collectWebResearch.version,
                            attemptNumber: attempts,
                            media: { imageInputCount: 0, videoFrameInputCount: 0 },
                            fallbackTokenCount:
                                analysisWebResearchConstraints.tokenReservationPerAttempt,
                            invoke: () =>
                                provider.collect({
                                    researchInput,
                                    queryPlan,
                                    tokenBudget:
                                        analysisWebResearchConstraints.providerTotalTokenLimit,
                                    signal: controller.signal,
                                    correlation: {
                                        requestId,
                                        taskId: task.id,
                                        attempt: attempts,
                                    },
                                }),
                            parse: createWebResearchResultParser(log, {
                                requestId,
                                taskId: task.id,
                                generationVersion: task.generationVersion,
                                attemptNumber: attempts,
                            }),
                            shouldRetry: (error) => canRetryWebResearch(error, attempts),
                        })
                        result = tracked.value
                        lastFailure = null
                        log.debug(
                            {
                                event: 'web_research_attempt_succeeded',
                                requestId,
                                taskId: task.id,
                                generationVersion: task.generationVersion,
                                attemptNumber: attempts,
                                researchStatus: result.status,
                                sourceCount: result.sources.length,
                            },
                            '联网资料收集成功',
                        )
                        break
                    } catch (error) {
                        if (error instanceof AgentCancelledError || controller.signal.aborted) {
                            return
                        }
                        lastFailure = error
                        log.debug(
                            {
                                event: 'web_research_attempt_failed',
                                requestId,
                                taskId: task.id,
                                generationVersion: task.generationVersion,
                                attemptNumber: attempts,
                                retryScheduled: canRetryWebResearch(error, attempts),
                                ...agentProviderErrorLogFields(error, false),
                            },
                            '联网资料收集失败',
                        )
                        if (!canRetryWebResearch(error, attempts)) break
                    }
                }
                if (lastFailure) {
                    log.warn(
                        {
                            event: 'web_research_degraded',
                            taskId: task.id,
                            generationVersion: task.generationVersion,
                            errorCategory: 'web_research_unavailable',
                        },
                        '联网资料暂不可用，使用用户草稿继续分析',
                    )
                }

                try {
                    await persistence.complete(task, result, clock.nowIso())
                    log.info(
                        {
                            event: 'web_research_completed',
                            taskId: task.id,
                            generationVersion: task.generationVersion,
                            researchStatus: result.status,
                        },
                        '正式分析前资料搜集完成',
                    )
                } catch (error) {
                    if (!(error instanceof AnalysisTaskLeaseLostError)) {
                        throw error
                    }
                }
            } finally {
                if (running.get(task.id) === controller) {
                    running.delete(task.id)
                }
            }
        },
        cancel(taskId) {
            const controller = running.get(taskId)
            if (!controller || controller.signal.aborted) {
                return false
            }
            controller.abort(new AgentCancelledError('用户放弃分析任务'))
            return true
        },
    }
}
