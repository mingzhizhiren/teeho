import { afterEach, expect, it, vi } from 'vitest'
import { AgentProviderError } from './analysis.provider'
import { AgentBusyExhaustedError, withAgentBusyRetry } from './analysis.agent-busy'

afterEach(() => vi.useRealTimers())

function setup() {
    vi.useFakeTimers()
    const controller = new AbortController()
    const onWaiting = vi.fn().mockResolvedValue(undefined)
    return {
        controller,
        onWaiting,
        options: {
            signal: controller.signal,
            stage: 'classification' as const,
            taskId: 'test',
            onWaiting,
            log: { warn: vi.fn() },
        },
    }
}
const busy = () => new AgentProviderError('temporary_unavailable', { ruleId: 'agent.busy' })

it('按10、30、60秒等待，最多四次调用，穷尽后禁止外层重试', async () => {
    const { options, onWaiting } = setup()
    const invoke = vi.fn().mockRejectedValue(busy())
    const pending = withAgentBusyRetry(options, invoke).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(9_999)
    expect(invoke).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(invoke).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(invoke).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(invoke).toHaveBeenCalledTimes(4)
    expect(await pending).toBeInstanceOf(AgentBusyExhaustedError)
    expect(await pending).toMatchObject({ retryable: false })
    expect(invoke.mock.calls.map(([canRetry]) => canRetry)).toEqual([true, true, true, false])
    expect(onWaiting.mock.calls).toEqual(
        Array.from({ length: 3 }, () => [
            ['classification', true],
            ['classification', false],
        ]).flat(),
    )
    expect(vi.getTimerCount()).toBe(0)
})

it('等待期间取消立即结束，不继续调用或迟到写回', async () => {
    const { options, controller, onWaiting } = setup()
    const invoke = vi.fn().mockRejectedValue(busy())
    const pending = withAgentBusyRetry(options, invoke).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(1)
    const reason = new Error('cancelled')
    controller.abort(reason)
    expect(await pending).toBe(reason)
    await vi.advanceTimersByTimeAsync(100_000)
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(onWaiting.mock.calls).toEqual([['classification', true]])
    expect(vi.getTimerCount()).toBe(0)
})

it('恢复后返回结果并清理等待标记；未知错误不进入等待', async () => {
    const { options, onWaiting } = setup()
    const invoke = vi.fn().mockRejectedValueOnce(busy()).mockResolvedValue('ok')
    const pending = withAgentBusyRetry(options, invoke)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await pending).toBe('ok')
    expect(onWaiting).toHaveBeenLastCalledWith('classification', false)
    const error = new AgentProviderError('unknown', { retryable: false })
    await expect(
        withAgentBusyRetry(options, async () => {
            throw error
        }),
    ).rejects.toBe(error)
    expect(vi.getTimerCount()).toBe(0)
})
