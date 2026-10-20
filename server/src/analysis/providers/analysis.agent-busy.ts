import {
    AgentProviderError,
    attachAgentProviderExecutionMetadata,
    readAgentProviderExecutionMetadata,
} from './analysis.provider'

export const AGENT_BUSY_RULE = 'agent.busy'
export const AGENT_BUSY_FAILURE_MESSAGE = '题火Agent正在忙碌，请稍候重新提交分析，本次未扣费'
const FIRST_RETRY_DELAY_MS = 10_000
const SECOND_RETRY_DELAY_MS = 30_000
const FINAL_RETRY_DELAY_MS = 60_000
export const AGENT_BUSY_RETRY_DELAYS_MS = [
    FIRST_RETRY_DELAY_MS,
    SECOND_RETRY_DELAY_MS,
    FINAL_RETRY_DELAY_MS,
] as const
export type AgentRetryStage = 'cover' | 'content' | 'classification' | 'review'
export type AgentRetryObserver = (stage: AgentRetryStage, waiting: boolean) => Promise<void>

/** 只有明确的容量拒绝和限流进入繁忙重试，不扩大未知错误的重试范围。 */
export function isAgentBusy(error: unknown): error is AgentProviderError {
    return (
        error instanceof AgentProviderError &&
        (error.ruleId === AGENT_BUSY_RULE || error.category === 'rate_limited')
    )
}

/** 繁忙预算耗尽后禁止外层重试；必需步骤不得降级为成功报告。 */
export class AgentBusyExhaustedError extends AgentProviderError {
    constructor(cause: AgentProviderError) {
        super('temporary_unavailable', {
            message: AGENT_BUSY_FAILURE_MESSAGE,
            retryable: false,
            ruleId: 'agent.busy.exhausted',
            cause,
        })
        const metadata = readAgentProviderExecutionMetadata(cause)
        if (metadata) attachAgentProviderExecutionMetadata(this, metadata)
    }
}

/** 等待共享任务的取消/总超时信号，并在结束后清除监听和计时器。 */
function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
        const abort = () => {
            clearTimeout(timer)
            signal.removeEventListener('abort', abort)
            reject(signal.reason)
        }
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', abort)
            resolve()
        }, delayMs)
        signal.addEventListener('abort', abort, { once: true })
    })
}

interface AgentBusyRetryOptions {
    signal: AbortSignal
    stage: AgentRetryStage
    onWaiting?: AgentRetryObserver
    log: { warn: (fields: Record<string, unknown>, message: string) => void }
    taskId: string
}

/** 每次只重试当前调用，最多三次；调用方保留已完成步骤和同一积分预留。 */
export async function withAgentBusyRetry<T>(
    options: AgentBusyRetryOptions,
    invoke: (canRetryBusy: boolean) => Promise<T>,
): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
        options.signal.throwIfAborted()
        const delayMs = AGENT_BUSY_RETRY_DELAYS_MS[attempt]
        try {
            return await invoke(delayMs !== undefined)
        } catch (error) {
            options.signal.throwIfAborted()
            if (!isAgentBusy(error) || !error.retryable) throw error
            if (delayMs === undefined) throw new AgentBusyExhaustedError(error)
            await options.onWaiting?.(options.stage, true)
            options.log.warn(
                {
                    event: 'analysis_agent_busy_retry_scheduled',
                    taskId: options.taskId,
                    stage: options.stage,
                    retryNumber: attempt + 1,
                    delayMs,
                    errorCategory: error.category,
                    ruleId: error.ruleId,
                },
                '题火Agent忙碌，等待后重试当前步骤',
            )
            try {
                await waitForRetry(delayMs, options.signal)
            } finally {
                // 取消、失租或超时时由任务终态/租约转换清理，禁止迟到回写。
                if (!options.signal.aborted) await options.onWaiting?.(options.stage, false)
            }
        }
    }
}
