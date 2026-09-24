import { TIME_MS } from '../../config/constants'
import { analysisConversationConstraints } from '../analysis.constants'
import type { MaterialUnderstandingInput } from '../materials/analysis.material'
import type {
    WebResearchCollectionInput,
    WebResearchProvider,
} from '../research/analysis.research-provider'
import {
    AgentCancelledError,
    AgentProviderError,
    AgentTimeoutError,
    type AgentConversationTurnInput,
    type AgentOutputRepairInput,
    type AgentProvider,
    type AgentResultGenerationInput,
} from './analysis.provider'

type Release = () => void

class AsyncSemaphore {
    private active = 0
    private readonly waiting: Array<{
        resolve: (release: Release) => void
        reject: (reason: unknown) => void
        signal: AbortSignal
        onAbort: () => void
    }> = []

    /**
     * 创建限制同时占用数量的异步信号量。
     * @param limit 允许并发占用的最大数量
     */
    constructor(private readonly limit: number) {}

    /**
     * 获取一个并发名额，并返回用于释放名额的函数。
     * @param signal 等待期间用于取消请求的信号
     */
    acquire(signal: AbortSignal): Promise<Release> {
        if (signal.aborted) {
            return Promise.reject(
                new AgentCancelledError('等待 Provider 时调用已取消', signal.reason),
            )
        }
        if (this.active < this.limit) {
            this.active += 1
            return Promise.resolve(this.createRelease())
        }

        return new Promise<Release>((resolve, reject) => {
            const entry = {
                resolve,
                reject,
                signal,
                onAbort: () => {
                    const index = this.waiting.indexOf(entry)
                    if (index >= 0) {
                        this.waiting.splice(index, 1)
                    }
                    reject(new AgentCancelledError('等待 Provider 时调用已取消', signal.reason))
                },
            }
            signal.addEventListener('abort', entry.onAbort, { once: true })
            this.waiting.push(entry)
        })
    }

    /** 创建只能释放一次的并发名额回收函数 */
    private createRelease(): Release {
        let released = false
        return () => {
            if (released) {
                return
            }
            released = true
            const next = this.waiting.shift()
            if (!next) {
                this.active -= 1
                return
            }
            next.signal.removeEventListener('abort', next.onAbort)
            next.resolve(this.createRelease())
        }
    }
}

/** 把未知异常包装为统一的 Provider 错误 */
function toProviderError(error: unknown) {
    if (error instanceof AgentProviderError) {
        return error
    }
    return new AgentProviderError('unknown', {
        message: 'Agent Provider 调用失败',
        retryable: false,
        cause: error,
    })
}

type GuardedProviderInput =
    | AgentConversationTurnInput
    | WebResearchCollectionInput
    | AgentResultGenerationInput

/** 让内容决策与资料搜集共享同一并发、超时和取消约束。 */
class ProviderCallGuard {
    private readonly semaphore: AsyncSemaphore

    constructor(
        private readonly callTimeoutMs: number,
        maxConcurrency: number,
    ) {
        this.semaphore = new AsyncSemaphore(maxConcurrency)
    }

    /** 在并发、超时和取消约束下调用实际 Provider。 */
    async run<Input extends GuardedProviderInput>(
        input: Input,
        invoke: (guardedInput: Input) => Promise<unknown>,
        timeoutMs = this.callTimeoutMs,
    ): Promise<unknown> {
        if (input.signal.aborted) {
            throw new AgentCancelledError('等待 Provider 时调用已取消', input.signal.reason)
        }
        const controller = new AbortController()
        let timedOut = false
        const forwardAbort = () => controller.abort(input.signal.reason)
        input.signal.addEventListener('abort', forwardAbort, { once: true })
        const timeout = setTimeout(() => {
            timedOut = true
            controller.abort(new AgentTimeoutError())
        }, timeoutMs)
        let release: Release | undefined
        let execution: Promise<unknown> | undefined
        let rejectOnAbort: (() => void) | undefined

        try {
            release = await this.semaphore.acquire(controller.signal)
            if (controller.signal.aborted) {
                release()
                release = undefined
                throw timedOut
                    ? new AgentTimeoutError('Agent Provider 调用超时')
                    : new AgentCancelledError('等待 Provider 时调用已取消', input.signal.reason)
            }
            let rejectAbort: ((reason: unknown) => void) | undefined
            const abortPromise = new Promise<never>((_, reject) => {
                rejectAbort = reject
            })
            rejectOnAbort = () => {
                rejectAbort?.(
                    timedOut
                        ? new AgentTimeoutError('Agent Provider 调用超时')
                        : new AgentCancelledError('Agent Provider 调用已取消', input.signal.reason),
                )
            }
            controller.signal.addEventListener('abort', rejectOnAbort, { once: true })
            execution = Promise.resolve().then(() =>
                invoke({ ...input, signal: controller.signal }),
            )
            return await Promise.race([execution, abortPromise])
        } catch (error) {
            if (timedOut) {
                throw new AgentTimeoutError('Agent Provider 调用超时', error)
            }
            if (input.signal.aborted) {
                throw new AgentCancelledError('Agent Provider 调用已取消', error)
            }
            throw toProviderError(error)
        } finally {
            clearTimeout(timeout)
            if (rejectOnAbort) {
                controller.signal.removeEventListener('abort', rejectOnAbort)
            }
            input.signal.removeEventListener('abort', forwardAbort)
            // 超时或取消只结束调用方等待；并发名额必须等底层调用真正退出后才能归还。
            if (execution && release) {
                void execution.then(release, release)
            } else {
                release?.()
            }
        }
    }
}

/**
 * 为所有 Provider 一视同仁地施加并发、超时和取消约束。
 * 适配器本身只负责传输，不得拥有额外的运行时特权。
 */
export class GuardedAgentProvider implements AgentProvider {
    private readonly guard: ProviderCallGuard

    constructor(provider: AgentProvider, callTimeoutMs: number, maxConcurrency: number)
    constructor(provider: AgentProvider, guard: ProviderCallGuard)
    constructor(
        private readonly provider: AgentProvider,
        guardOrTimeout: ProviderCallGuard | number,
        maxConcurrency?: number,
    ) {
        this.guard =
            guardOrTimeout instanceof ProviderCallGuard
                ? guardOrTimeout
                : new ProviderCallGuard(guardOrTimeout, maxConcurrency ?? 1)
    }

    formConversationTurn(input: AgentConversationTurnInput): Promise<unknown> {
        if (!this.provider.formConversationTurn) {
            return Promise.reject(
                new AgentProviderError('capability', {
                    message: 'Agent Provider 不支持真实多轮任务形成',
                    retryable: false,
                }),
            )
        }
        const attemptIndex = (input.correlation?.attempt ?? 1) - 1
        const timeouts = analysisConversationConstraints.providerAttemptTimeoutSeconds
        return this.guard.run(
            input,
            (guardedInput) => this.provider.formConversationTurn!(guardedInput),
            (timeouts[attemptIndex] ?? timeouts[0]) * TIME_MS.SECOND,
        )
    }

    /**
     * 在并发、超时和取消约束下生成最终结果。
     * @param input 结果生成输入及取消信号
     */
    generateResult(input: AgentResultGenerationInput): Promise<unknown> {
        return this.guard.run(input, (guardedInput) => this.provider.generateResult(guardedInput))
    }

    /** 素材理解共用相同并发、超时和取消边界。 */
    understandMaterial(input: MaterialUnderstandingInput): Promise<unknown> {
        if (!this.provider.understandMaterial)
            return Promise.reject(new AgentProviderError('capability', { retryable: false }))
        return this.guard.run(input, (guardedInput) =>
            this.provider.understandMaterial!(guardedInput),
        )
    }

    /** 在相同超时与取消边界内执行一次最终输出修复。 */
    repairResult(input: AgentOutputRepairInput): Promise<unknown> {
        if (!this.provider.repairResult) {
            return Promise.reject(
                new AgentProviderError('capability', {
                    message: 'Agent Provider 不支持输出修复',
                    retryable: false,
                }),
            )
        }
        return this.guard.run(input.generationInput, () => this.provider.repairResult!(input))
    }
}

class GuardedWebResearchProvider implements WebResearchProvider {
    constructor(
        private readonly provider: WebResearchProvider,
        private readonly guard: ProviderCallGuard,
    ) {}

    collect(input: WebResearchCollectionInput): Promise<unknown> {
        return this.guard.run(input, (guardedInput) => this.provider.collect(guardedInput))
    }
}

/** 为语言模型与可选资料源创建共享运行约束的适配器。 */
export function createGuardedProviders(
    agentProvider: AgentProvider,
    webResearchProvider: WebResearchProvider | null,
    callTimeoutMs: number,
    maxConcurrency: number,
) {
    const guard = new ProviderCallGuard(callTimeoutMs, maxConcurrency)
    return {
        agent: new GuardedAgentProvider(agentProvider, guard),
        webResearch: webResearchProvider
            ? new GuardedWebResearchProvider(webResearchProvider, guard)
            : null,
    } as const
}
