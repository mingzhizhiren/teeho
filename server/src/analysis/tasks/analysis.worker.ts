import { TIME_MS } from '../../config/constants'
import type { WebResearchTaskExecutor } from '../research/analysis.web-research.execution'
import type { WebResearchTaskClaimOutcome } from '../research/analysis.web-research.repository'
import type { AnalysisTaskExecutor } from './analysis.execution'
import type { AnalysisTaskClaimOutcome } from './analysis.queue.repository'

/** Worker 调度使用的可替换时钟。 */
export interface AnalysisWorkerClock {
    now: () => number
    randomUUID: () => string
    setInterval: typeof setInterval
    clearInterval: typeof clearInterval
}

export interface AnalysisWorkerLogger {
    error: (fields: Record<string, unknown>, message: string) => void
}

type ClaimNextAnalysisTask = (
    workerId: string,
    processingTimeoutSeconds: number,
    leaseSeconds: number,
) => Promise<AnalysisTaskClaimOutcome>

type RecoverExpiredAnalysisTaskLeases = (timeoutSeconds: number) => Promise<unknown>
type ClaimNextWebResearchTask = (
    workerId: string,
    timeoutSeconds: number,
) => Promise<WebResearchTaskClaimOutcome>

/** Worker 所需的调度依赖；单次分析尝试由 executor 完整封装。 */
export interface AnalysisTaskWorkerOptions {
    executor: AnalysisTaskExecutor
    researchExecutor?: WebResearchTaskExecutor
    claimNextResearchTask?: ClaimNextWebResearchTask
    claimNextTask: ClaimNextAnalysisTask
    recoverExpiredTaskLeases: RecoverExpiredAnalysisTaskLeases
    processingTimeoutMs: number
    taskLeaseMs: number
    pollIntervalMs: number
    clock: AnalysisWorkerClock
    log: AnalysisWorkerLogger
}

/** Worker 生产调度时钟。 */
export const systemAnalysisWorkerClock: AnalysisWorkerClock = {
    now: Date.now,
    randomUUID: () => crypto.randomUUID(),
    setInterval,
    clearInterval,
}

/** PostgreSQL 后台队列 Worker；只负责生命周期、领取与轮询。 */
export class AnalysisTaskWorker {
    private readonly workerId: string
    private readonly executor: AnalysisTaskExecutor
    private readonly researchExecutor: WebResearchTaskExecutor | undefined
    private readonly claimNextResearchTask: ClaimNextWebResearchTask | undefined
    private readonly claimNextTask: ClaimNextAnalysisTask
    private readonly recoverExpiredTaskLeases: RecoverExpiredAnalysisTaskLeases
    private readonly processingTimeoutMs: number
    private readonly taskLeaseMs: number
    private readonly pollIntervalMs: number
    private readonly clock: AnalysisWorkerClock
    private readonly log: AnalysisWorkerLogger
    private timer: ReturnType<typeof setInterval> | undefined
    private drainPromise: Promise<void> | undefined
    private started = false

    /**
     * 创建负责领取、恢复和执行分析任务的后台 Worker。
     * @param options 执行器、队列操作、轮询周期、时钟及日志配置
     */
    constructor(options: AnalysisTaskWorkerOptions) {
        this.executor = options.executor
        this.researchExecutor = options.researchExecutor
        this.claimNextResearchTask = options.claimNextResearchTask
        this.claimNextTask = options.claimNextTask
        this.recoverExpiredTaskLeases = options.recoverExpiredTaskLeases
        this.processingTimeoutMs = options.processingTimeoutMs
        this.taskLeaseMs = options.taskLeaseMs
        this.pollIntervalMs = options.pollIntervalMs
        this.clock = options.clock
        this.log = options.log
        this.workerId = this.clock.randomUUID()
    }

    /** 启动轮询；不会在模块 import 时产生后台副作用。 */
    start() {
        if (this.started) {
            return
        }
        this.started = true
        this.timer = this.clock.setInterval(() => this.wake(), this.pollIntervalMs)
        this.timer.unref?.()
        this.wake()
    }

    /** 新任务入队后主动唤醒。 */
    wake() {
        if (!this.started || this.drainPromise) {
            return
        }
        this.drainPromise = this.drain()
            .catch((error: unknown) => {
                this.log.error(
                    {
                        event: 'analysis_worker_drain_failed',
                        workerId: this.workerId,
                        stage: 'drain',
                        errorCategory: 'worker_failure',
                        err: error,
                    },
                    '分析队列 worker 运行失败',
                )
            })
            .finally(() => {
                this.drainPromise = undefined
            })
    }

    /** 暴露只读生命周期快照，供维护恢复健康矩阵判断待命状态。 */
    readReadiness(): { readonly started: boolean; readonly busy: boolean } {
        return { started: this.started, busy: Boolean(this.drainPromise) }
    }

    /** 持续领取并串行执行当前可处理的分析任务 */
    private async drain() {
        const processingTimeoutSeconds = Math.ceil(this.processingTimeoutMs / TIME_MS.SECOND)
        const leaseSeconds = Math.ceil(this.taskLeaseMs / TIME_MS.SECOND)
        await this.recoverExpiredTaskLeases(processingTimeoutSeconds)

        while (this.started) {
            if (this.researchExecutor && this.claimNextResearchTask) {
                const researchOutcome = await this.claimNextResearchTask(
                    this.workerId,
                    processingTimeoutSeconds,
                )
                if (researchOutcome?.kind === 'claimed') {
                    await this.researchExecutor.execute(researchOutcome.task)
                    continue
                }
            }
            const outcome: AnalysisTaskClaimOutcome = await this.claimNextTask(
                this.workerId,
                processingTimeoutSeconds,
                leaseSeconds,
            )
            if (!outcome) {
                return
            }
            if (outcome.kind === 'claimed') {
                await this.executor.execute(outcome.task)
            }
        }
    }

    /** 停止领取新任务，并等待当前尝试完成状态写入。 */
    async stop() {
        this.started = false
        if (this.timer) {
            this.clock.clearInterval(this.timer)
            this.timer = undefined
        }
        await this.drainPromise
    }
}
