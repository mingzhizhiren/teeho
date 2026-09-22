import { env } from '../../config/env'
import type { PluginRuntime } from '../../customization/contract'
import { PluginError } from '../../customization/runtime'
import { db, withTransaction } from '../../db/database'
import type { predictInsight } from '../../runtime/insight'
import { createAnalysisCompletedNotification } from '../../notifications/notification.repository'
import { getTaskPolicy, type TaskPolicy } from '../../runtime/task-policy'
import { logger } from '../../utils/logger'
import { loadAgentVideoEvidenceForTask } from '../../video/video.analysis-evidence'
import { resetVideoStartEventsForAnalysisSuccess } from '../../video/video.repository'
import { analysisExecutionConstraints } from '../analysis.constants'
import {
    AnalysisAssetExpiredError,
    AnalysisReferenceUnavailableError,
    AnalysisTaskLeaseLostError,
    AnalysisVideoEvidenceExpiredError,
} from '../analysis.errors'
import {
    type AgentAnalysisResult,
    type AnalysisFailure,
    type AnalysisInternalExecutionTrace,
} from '../analysis.schema'
import { evaluateAnalysisCheckup } from '../checkup/analysis.checkup.evaluation'
import type { CheckupTopicEvidenceSource } from '../checkup/analysis.checkup.topics'
import type { AnalysisEvidenceSource } from '../evidence/analysis.evidence'
import {
    findFrozenAnalysisEvidenceSet,
    freezeAnalysisEvidenceSet,
} from '../evidence/analysis.evidence-set.repository'
import { requestAnalysisTaskOriginalImageCleanupBestEffort } from '../media/analysis.asset-lifecycle.service'
import { loadAgentImagesForTask } from '../media/analysis.media-delivery'
import { requiredAnalysisImageReferences } from '../media/analysis.media-input'
import {
    analysisContractVersions,
    logAnalysisContractPersisted,
} from '../providers/analysis.contract-telemetry'
import {
    AgentCancelledError,
    AgentContractError,
    AgentProviderError,
    AgentTimeoutError,
    agentProviderErrorLogFields,
    sanitizeAgentProviderDebugDetails,
    type AgentProvider,
} from '../providers/analysis.provider'
import { prepareTaskImagesForProvider } from '../providers/analysis.provider-media'
import {
    agentUsageCallService,
    type AgentUsageCallService,
    type AgentUsageProviderDescriptor,
} from '../usage/analysis.agent-usage.service'
import {
    hasActiveAnalysisTaskLease,
    markAnalysisTaskFailed,
    markAnalysisTaskSucceeded,
    renewAnalysisTaskLease,
    scheduleAnalysisTaskRetry,
    type ClaimedAnalysisTask,
} from './analysis.queue.repository'
import { insertAnalysisResult } from './analysis.result.repository'
import { startAnalysisTaskLeaseMonitor } from './analysis.task-lease-monitor'

/** 单次分析尝试的执行模块；调度生命周期由 Worker 模块负责。 */
const publicFailureMessage = '服务器功能异常'

/** 可写入执行追踪与内部用量归因的 Provider 描述。 */
export type AnalysisProviderDescriptor = AgentUsageProviderDescriptor

/** 单次任务执行可覆盖的证据源、Provider 描述与时间边界。 */
export interface ProcessAnalysisTaskOptions {
    insightEnabled?: boolean
    plugins?: PluginRuntime
    predict?: typeof predictInsight
    referenceSource?: AnalysisEvidenceSource
    evaluate?: typeof evaluateAnalysisCheckup
    topicEvidenceSource?: CheckupTopicEvidenceSource
    evidenceSource?: AnalysisEvidenceSource
    providerDescriptor?: AnalysisProviderDescriptor
    processingTimeoutMs?: number
    cancellationPollIntervalMs?: number
    taskLeaseMs?: number
    taskLeaseRenewalIntervalMs?: number
}

/** 单次分析尝试执行器向 Worker 暴露的唯一接口。 */
export interface AnalysisTaskExecutor {
    execute: (task: ClaimedAnalysisTask) => Promise<void>
    cancel: (taskId: string) => boolean
}

/** 单次分析尝试所需的持久化与跨 Feature 事务能力。 */
export interface AnalysisTaskExecutionPersistence {
    withTransaction: typeof withTransaction
    findImagesForTask: typeof loadAgentImagesForTask
    findVideoEvidenceForTask: typeof loadAgentVideoEvidenceForTask
    findFrozenEvidenceSet: typeof findFrozenAnalysisEvidenceSet
    freezeEvidenceSet: typeof freezeAnalysisEvidenceSet
    hasActiveTaskLease: typeof hasActiveAnalysisTaskLease
    renewTaskLease: (
        taskId: string,
        userId: string,
        attemptCount: number,
        workerId: string,
        processingTimeoutSeconds: number,
        leaseSeconds: number,
    ) => Promise<boolean>
    insertResult: typeof insertAnalysisResult
    chargePoints: TaskPolicy['settle']
    releasePoints: TaskPolicy['release']
    resetVideoStarts: typeof resetVideoStartEventsForAnalysisSuccess
    createNotification: typeof createAnalysisCompletedNotification
    markTaskSucceeded: typeof markAnalysisTaskSucceeded
    scheduleTaskRetry: typeof scheduleAnalysisTaskRetry
    markTaskFailed: typeof markAnalysisTaskFailed
    requestOriginalImageCleanup: typeof requestAnalysisTaskOriginalImageCleanupBestEffort
}

/** 单次分析尝试使用的可替换时钟。 */
export interface AnalysisExecutionClock {
    now: () => number
    randomUUID: () => string
    setTimeout: typeof setTimeout
    clearTimeout: typeof clearTimeout
    setInterval: typeof setInterval
    clearInterval: typeof clearInterval
}

type AnalysisExecutionLogger = Pick<typeof logger, 'debug' | 'error' | 'info' | 'warn'>

/** PostgreSQL 生产持久化适配器。 */
export const postgresAnalysisTaskExecutionPersistence: AnalysisTaskExecutionPersistence = {
    withTransaction,
    findImagesForTask: loadAgentImagesForTask,
    findVideoEvidenceForTask: loadAgentVideoEvidenceForTask,
    findFrozenEvidenceSet: findFrozenAnalysisEvidenceSet,
    freezeEvidenceSet: freezeAnalysisEvidenceSet,
    hasActiveTaskLease: hasActiveAnalysisTaskLease,
    renewTaskLease: (...args) => renewAnalysisTaskLease(db, ...args),
    insertResult: insertAnalysisResult,
    chargePoints: (...args) => getTaskPolicy().settle(...args),
    releasePoints: (...args) => getTaskPolicy().release(...args),
    resetVideoStarts: resetVideoStartEventsForAnalysisSuccess,
    createNotification: createAnalysisCompletedNotification,
    markTaskSucceeded: markAnalysisTaskSucceeded,
    scheduleTaskRetry: scheduleAnalysisTaskRetry,
    markTaskFailed: markAnalysisTaskFailed,
    requestOriginalImageCleanup: requestAnalysisTaskOriginalImageCleanupBestEffort,
}

/** 系统生产时钟。 */
export const systemAnalysisExecutionClock: AnalysisExecutionClock = {
    now: Date.now,
    randomUUID: () => crypto.randomUUID(),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
}

/** 创建执行器所需的稳定运行时依赖。 */
export interface CreateAnalysisTaskExecutorOptions extends ProcessAnalysisTaskOptions {
    plugins: PluginRuntime
    provider: AgentProvider
    evidenceSource: AnalysisEvidenceSource
    providerDescriptor: AnalysisProviderDescriptor
    persistence?: AnalysisTaskExecutionPersistence
    clock?: AnalysisExecutionClock
    log?: AnalysisExecutionLogger
    usage?: AgentUsageCallService
}

interface AnalysisTaskExecutionRuntime {
    insightEnabled: boolean
    plugins: PluginRuntime
    predict?: typeof predictInsight
    referenceSource?: AnalysisEvidenceSource
    evaluate: typeof evaluateAnalysisCheckup
    topicEvidenceSource?: CheckupTopicEvidenceSource
    provider: AgentProvider
    evidenceSource: AnalysisEvidenceSource
    providerDescriptor: AnalysisProviderDescriptor
    processingTimeoutMs: number
    cancellationPollIntervalMs: number
    taskLeaseMs: number
    taskLeaseRenewalIntervalMs: number
    persistence: AnalysisTaskExecutionPersistence
    clock: AnalysisExecutionClock
    log: AnalysisExecutionLogger
    usage: AgentUsageCallService
    runningTaskControllers: Map<string, AbortController>
}

/** 创建绑定固定 Provider、证据源和运行约束的单次分析执行器。 */
export function createAnalysisTaskExecutor(
    options: CreateAnalysisTaskExecutorOptions,
): AnalysisTaskExecutor {
    const runtime: AnalysisTaskExecutionRuntime = {
        insightEnabled: options.insightEnabled ?? env.TEEHO_INSIGHT_ENABLED,
        plugins: options.plugins,
        predict: options.predict,
        referenceSource: options.referenceSource,
        evaluate: options.evaluate ?? evaluateAnalysisCheckup,
        topicEvidenceSource: options.plugins?.topicSource ?? options.topicEvidenceSource,
        provider: options.provider,
        evidenceSource: options.plugins?.dataSource ?? options.evidenceSource,
        providerDescriptor: options.providerDescriptor,
        processingTimeoutMs:
            options.processingTimeoutMs ?? analysisExecutionConstraints.defaultProcessingTimeoutMs,
        cancellationPollIntervalMs:
            options.cancellationPollIntervalMs ??
            analysisExecutionConstraints.cancellationPollIntervalMs,
        taskLeaseMs: options.taskLeaseMs ?? analysisExecutionConstraints.defaultTaskLeaseMs,
        taskLeaseRenewalIntervalMs:
            options.taskLeaseRenewalIntervalMs ??
            analysisExecutionConstraints.taskLeaseRenewalIntervalMs,
        persistence: options.persistence ?? postgresAnalysisTaskExecutionPersistence,
        clock: options.clock ?? systemAnalysisExecutionClock,
        log: options.log ?? logger,
        usage: options.usage ?? agentUsageCallService,
        runningTaskControllers: new Map<string, AbortController>(),
    }
    return {
        execute: (task) => processClaimedAnalysisTask(task, runtime),
        /**
         * 尽力终止当前进程中正在执行的分析任务。
         * @param taskId 要取消的分析任务 ID
         */
        cancel(taskId) {
            const controller = runtime.runningTaskControllers.get(taskId)
            if (!controller || controller.signal.aborted) {
                return false
            }
            controller.abort(new AgentCancelledError('用户放弃分析任务'))
            return true
        },
    }
}

/** 把未知异常转换为稳定的分析失败结果 */
function toAnalysisFailure(error: unknown): AnalysisFailure {
    if (error instanceof AgentContractError && error.ruleId === 'radar.coverage.required')
        return { code: 'radar_unavailable', message: '本次没有足够的六维证据，未扣费。' }
    if (error instanceof AgentContractError && error.ruleId === 'insight.coverage.required')
        return {
            code: 'insight_unavailable',
            message: '当前模型无法可靠评估这篇笔记，本次未扣费。',
        }
    if (error instanceof AnalysisReferenceUnavailableError)
        return { code: 'no_reference_notes', message: '本次没有找到有效参考笔记，未扣费。' }
    if (error instanceof AnalysisVideoEvidenceExpiredError) {
        return { code: 'video_evidence_expired', message: publicFailureMessage }
    }
    if (error instanceof AnalysisAssetExpiredError) {
        return { code: 'image_expired', message: publicFailureMessage }
    }
    if (error instanceof AgentTimeoutError) {
        return { code: 'agent_timeout', message: publicFailureMessage }
    }
    if (error instanceof AgentContractError) {
        return { code: 'agent_invalid_output', message: publicFailureMessage }
    }
    return { code: 'agent_failure', message: publicFailureMessage }
}

/** 提取适合写入日志的脱敏错误字段 */
export function analysisExecutionErrorLogFields(error: unknown, includeDebugDetails: boolean) {
    if (error instanceof PluginError)
        return {
            errorCategory: 'plugin_failure',
            capability: error.capability,
            ruleId: error.category,
            validationFieldPaths: [],
        }
    if (error instanceof AgentProviderError) {
        return agentProviderErrorLogFields(error, includeDebugDetails)
    }
    if (error instanceof AnalysisVideoEvidenceExpiredError) {
        return {
            errorCategory: 'video_evidence_expired',
            validationFieldPaths: [],
            ruleId: 'task.video-evidence.available',
        }
    }
    if (error instanceof AnalysisAssetExpiredError) {
        return {
            errorCategory: 'image_expired',
            validationFieldPaths: [],
            ruleId: 'task.images.available',
        }
    }
    return {
        errorCategory: 'unknown',
        diagnosticMessage: '后台分析内部异常',
        validationFieldPaths: [],
        ruleId: 'analysis-execution.unclassified',
        ...(includeDebugDetails
            ? {
                  executionDebug: sanitizeAgentProviderDebugDetails({
                      stage: 'analysis-execution.unclassified',
                      errorName: error instanceof Error ? error.name : typeof error,
                      message: error instanceof Error ? error.message : String(error),
                  }),
              }
            : {}),
    }
}

/** 读取并验证任务关联的图片素材 */
async function loadTaskImages(
    task: ClaimedAnalysisTask,
    persistence: AnalysisTaskExecutionPersistence,
) {
    const references = requiredAnalysisImageReferences(task.standardTask)
    const storedImages = await persistence.findImagesForTask(task.userId, references)
    if (
        storedImages.length !== references.length ||
        storedImages.some((image, index) => image.reference !== references[index])
    ) {
        throw new AnalysisAssetExpiredError()
    }
    return {
        originals: storedImages,
        providerImages: await prepareTaskImagesForProvider(storedImages, task.subscriptionTier),
    }
}

/** 读取视频快照对应的已校验关键帧和媒体元数据。 */
async function loadTaskVideoEvidence(
    task: ClaimedAnalysisTask,
    persistence: AnalysisTaskExecutionPersistence,
) {
    if (task.standardTask.contentKind !== 'video') {
        return null
    }
    const snapshot = task.standardTask.videoEvidence
    if (!snapshot) {
        throw new AnalysisVideoEvidenceExpiredError()
    }
    const delivery = await persistence.findVideoEvidenceForTask(task.id, task.userId, snapshot)
    if (!delivery) {
        throw new AnalysisVideoEvidenceExpiredError()
    }
    return delivery
}

/** 根据数据库中首次开始时间计算自动重试共享的剩余任务预算。 */
export function remainingAnalysisTaskBudgetMs(
    processingStartedAt: string,
    processingTimeoutMs: number,
    now = Date.now(),
): number {
    return Math.max(0, Date.parse(processingStartedAt) + processingTimeoutMs - now)
}

/** 启动任务租约续期与失效监控 */
function startTaskLeaseMonitor(
    task: ClaimedAnalysisTask,
    abortController: AbortController,
    intervalMs: number,
    runtime: AnalysisTaskExecutionRuntime,
) {
    let failureLogged = false
    return startAnalysisTaskLeaseMonitor({
        task,
        abortController,
        checkIntervalMs: intervalMs,
        renewalIntervalMs: runtime.taskLeaseRenewalIntervalMs,
        processingTimeoutMs: runtime.processingTimeoutMs,
        leaseMs: runtime.taskLeaseMs,
        hasActiveLease: () =>
            runtime.persistence.hasActiveTaskLease(
                task.id,
                task.userId,
                task.attemptCount,
                task.workerId,
            ),
        renewLease: (processingTimeoutSeconds, leaseSeconds) =>
            runtime.persistence.renewTaskLease(
                task.id,
                task.userId,
                task.attemptCount,
                task.workerId,
                processingTimeoutSeconds,
                leaseSeconds,
            ),
        clock: runtime.clock,
        onState: () => {
            failureLogged = false
        },
        onFailure: () => {
            if (failureLogged) return
            failureLogged = true
            logLeaseMonitorFailure(task, runtime)
        },
    })
}

function logLeaseMonitorFailure(task: ClaimedAnalysisTask, runtime: AnalysisTaskExecutionRuntime) {
    runtime.log.warn(
        {
            event: 'analysis_task_lease_monitor_failed',
            taskId: task.id,
            attemptNumber: task.attemptCount,
            errorCategory: 'task_lease_monitor_failure',
        },
        '分析任务租约检查失败，将继续重试',
    )
}

interface GeneratedTaskOutcome {
    result: AgentAnalysisResult
    trace: AnalysisInternalExecutionTrace
}

interface TaskGenerationContext {
    images: Awaited<ReturnType<typeof loadTaskImages>>
    videoDelivery: Awaited<ReturnType<typeof loadTaskVideoEvidence>>
    requestId: string
    signal: AbortSignal
    runtime: AnalysisTaskExecutionRuntime
}
async function generateFirstTaskOutcome(
    task: ClaimedAnalysisTask,
    context: TaskGenerationContext,
): Promise<GeneratedTaskOutcome> {
    return context.runtime.evaluate({
        insightEnabled: context.runtime.insightEnabled,
        plugins: context.runtime.plugins,
        predict: context.runtime.predict,
        referenceSource: context.runtime.referenceSource,
        task,
        requestId: context.requestId,
        asOfDate: task.processingStartedAt.split('T')[0]!,
        asOf: task.processingStartedAt,
        signal: context.signal,
        evidenceSource: context.runtime.evidenceSource,
        topicEvidenceSource: context.runtime.topicEvidenceSource,
        evidenceStore: {
            find: (taskId, userId) =>
                context.runtime.persistence.findFrozenEvidenceSet(taskId, userId),
            freeze: (taskId, userId, evidence) =>
                context.runtime.persistence.freezeEvidenceSet(taskId, userId, evidence),
        },
        agent: {
            provider: context.runtime.provider,
            descriptor: context.runtime.providerDescriptor,
            usage: context.runtime.usage,
        },
        media: {
            images: context.videoDelivery
                ? [...context.images.providerImages, ...context.videoDelivery.frames]
                : context.images.providerImages,
            originalImages: context.videoDelivery
                ? [...context.images.originals, ...context.videoDelivery.frames]
                : context.images.originals,
            videoEvidence: context.videoDelivery?.evidence ?? null,
            imageInputCount: context.images.providerImages.length,
            videoFrameInputCount: context.videoDelivery?.frames.length ?? 0,
        },
        log: context.runtime.log,
    })
}

async function generateTaskOutcome(
    task: ClaimedAnalysisTask,
    startedAt: number,
    requestId: string,
    signal: AbortSignal,
    runtime: AnalysisTaskExecutionRuntime,
): Promise<GeneratedTaskOutcome> {
    const [images, videoDelivery] = await Promise.all([
        loadTaskImages(task, runtime.persistence),
        loadTaskVideoEvidence(task, runtime.persistence),
    ])
    const context = { images, videoDelivery, requestId, signal, runtime }
    return generateFirstTaskOutcome(task, context)
}

async function commitTaskSuccess(
    task: ClaimedAnalysisTask,
    outcome: GeneratedTaskOutcome,
    persistence: AnalysisTaskExecutionPersistence,
    log: AnalysisExecutionLogger,
    requestId: string,
) {
    await persistence.withTransaction(async (transaction) => {
        await persistence.insertResult(transaction, {
            taskId: task.id,
            userId: task.userId,
            resultVersion: task.resultVersion,
            result: outcome.result,
            trace: outcome.trace,
        })
        await persistence.chargePoints(
            transaction,
            task.userId,
            task.id,
            task.resultVersion,
            task.pointCost,
        )
        if (task.standardTask.contentKind === 'video' && task.standardTask.videoEvidence) {
            await persistence.resetVideoStarts(
                transaction,
                task.userId,
                task.standardTask.videoEvidence.assetId,
            )
        }
        await persistence.createNotification(transaction, task.userId, task.id, task.resultVersion)
        await persistence.markTaskSucceeded(
            transaction,
            task.id,
            task.userId,
            task.attemptCount,
            task.workerId,
        )
    })
    persistence.requestOriginalImageCleanup(task.userId, task.id)
    const context = {
        requestId,
        taskId: task.id,
        resultVersion: task.resultVersion,
        attemptNumber: task.attemptCount,
    }
    logAnalysisContractPersisted(log, context, analysisContractVersions.result)
    logAnalysisContractPersisted(log, context, analysisContractVersions.executionTrace)
}

function handledStoppedAttempt(
    error: unknown,
    task: ClaimedAnalysisTask,
    requestId: string,
    startedAt: number,
    totalTimedOut: boolean,
    runtime: AnalysisTaskExecutionRuntime,
): boolean {
    if (error instanceof AnalysisTaskLeaseLostError) {
        runtime.log.warn(
            {
                event: 'analysis_task_late_result_ignored',
                taskId: task.id,
                attemptNumber: task.attemptCount,
                requestId,
                durationMs: runtime.clock.now() - startedAt,
            },
            '忽略租约失效后的迟到分析结果',
        )
        return true
    }
    if (error instanceof AgentCancelledError && !totalTimedOut) {
        runtime.log.info(
            {
                event: 'analysis_task_stopped',
                taskId: task.id,
                attemptNumber: task.attemptCount,
                requestId,
                durationMs: runtime.clock.now() - startedAt,
            },
            '分析任务已停止',
        )
        return true
    }
    return false
}

async function persistTaskFailure(
    error: unknown,
    task: ClaimedAnalysisTask,
    requestId: string,
    startedAt: number,
    runtime: AnalysisTaskExecutionRuntime,
) {
    const failure = toAnalysisFailure(error)
    if (error instanceof AnalysisReferenceUnavailableError) {
        runtime.log.info(
            {
                event: 'analysis_task_business_failed',
                taskId: task.id,
                requestId,
                failureCode: failure.code,
                referenceSelection: error.selection,
                retryDecision: 'fail',
            },
            '参考数据不足，任务失败并释放预留积分',
        )
    } else
        runtime.log.error(
            {
                event: 'analysis_task_attempt_failed',
                ...analysisExecutionErrorLogFields(error, typeof DEBUG !== 'undefined' && DEBUG),
                taskId: task.id,
                attemptNumber: task.attemptCount,
                requestId,
                durationMs: runtime.clock.now() - startedAt,
                retryDecision: 'fail',
            },
            'Provider 后台分析尝试失败',
        )
    try {
        await runtime.persistence.withTransaction(async (transaction) => {
            await runtime.persistence.markTaskFailed(
                transaction,
                task.id,
                task.userId,
                task.attemptCount,
                task.workerId,
                failure,
            )
            await runtime.persistence.releasePoints(
                transaction,
                task.userId,
                task.id,
                task.resultVersion,
            )
        })
    } catch (stateError) {
        if (!(stateError instanceof AnalysisTaskLeaseLostError)) throw stateError
        runtime.log.warn(
            {
                event: 'analysis_task_late_failure_ignored',
                taskId: task.id,
                attemptNumber: task.attemptCount,
                requestId,
            },
            '忽略租约回收或取消后的迟到失败状态',
        )
    }
}

interface AnalysisTaskAttempt {
    requestId: string
    startedAt: number
    signal: AbortSignal
    hasTimedOut: () => boolean
    finish: () => Promise<void>
}

function startAnalysisTaskAttempt(
    task: ClaimedAnalysisTask,
    runtime: AnalysisTaskExecutionRuntime,
): AnalysisTaskAttempt {
    const requestId = runtime.clock.randomUUID()
    const startedAt = runtime.clock.now()
    const controller = new AbortController()
    let timedOut = false
    runtime.runningTaskControllers.set(task.id, controller)
    const remainingBudgetMs = remainingAnalysisTaskBudgetMs(
        task.processingStartedAt,
        runtime.processingTimeoutMs,
        startedAt,
    )
    const timeout = runtime.clock.setTimeout(() => {
        timedOut = true
        controller.abort(new AgentTimeoutError('分析任务总执行时间超过十分钟'))
    }, remainingBudgetMs)
    const stopLeaseMonitor = startTaskLeaseMonitor(
        task,
        controller,
        runtime.cancellationPollIntervalMs,
        runtime,
    )
    return {
        requestId,
        startedAt,
        signal: controller.signal,
        hasTimedOut: () => timedOut,
        async finish() {
            runtime.clock.clearTimeout(timeout)
            await stopLeaseMonitor()
            if (runtime.runningTaskControllers.get(task.id) === controller) {
                runtime.runningTaskControllers.delete(task.id)
            }
        },
    }
}

function logTaskSuccess(
    task: ClaimedAnalysisTask,
    attempt: AnalysisTaskAttempt,
    runtime: AnalysisTaskExecutionRuntime,
) {
    runtime.log.info(
        {
            event: 'analysis_task_attempt_succeeded',
            taskId: task.id,
            attemptNumber: task.attemptCount,
            requestId: attempt.requestId,
            durationMs: runtime.clock.now() - attempt.startedAt,
        },
        '分析任务完成',
    )
}

/** 数据源和Provider都受同一个任务取消/超时边界约束。 */
function withinTaskSignal<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(signal.reason)
    return new Promise<T>((resolve, reject) => {
        const abort = () => reject(signal.reason ?? new AgentCancelledError('分析已停止'))
        signal.addEventListener('abort', abort, { once: true })
        Promise.resolve()
            .then(() => {
                if (signal.aborted) throw signal.reason
                return operation()
            })
            .then(
                (value) => {
                    signal.removeEventListener('abort', abort)
                    if (signal.aborted) reject(signal.reason)
                    else resolve(value)
                },
                (error: unknown) => {
                    signal.removeEventListener('abort', abort)
                    reject(error)
                },
            )
    })
}

/** 执行一个已领取任务，独立保存体检结果及计费终态。 */
async function processClaimedAnalysisTask(
    task: ClaimedAnalysisTask,
    runtime: AnalysisTaskExecutionRuntime,
) {
    const attempt = startAnalysisTaskAttempt(task, runtime)
    try {
        const outcome = await withinTaskSignal(
            () =>
                generateTaskOutcome(
                    task,
                    attempt.startedAt,
                    attempt.requestId,
                    attempt.signal,
                    runtime,
                ),
            attempt.signal,
        )
        await commitTaskSuccess(task, outcome, runtime.persistence, runtime.log, attempt.requestId)
        logTaskSuccess(task, attempt, runtime)
    } catch (caughtError) {
        const timedOut = attempt.hasTimedOut()
        const error = timedOut ? new AgentTimeoutError('分析任务总执行超时') : caughtError
        if (
            handledStoppedAttempt(
                error,
                task,
                attempt.requestId,
                attempt.startedAt,
                timedOut,
                runtime,
            )
        )
            return
        await persistTaskFailure(error, task, attempt.requestId, attempt.startedAt, runtime)
    } finally {
        await attempt.finish()
    }
}
