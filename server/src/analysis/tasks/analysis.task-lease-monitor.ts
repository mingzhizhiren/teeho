import { TIME_MS } from '../../config/constants'
import { AgentCancelledError } from '../providers/analysis.provider'
import type { ClaimedAnalysisTask } from './analysis.queue.repository'

interface AnalysisTaskLeaseMonitorClock {
    setInterval: typeof setInterval
    clearInterval: typeof clearInterval
}

interface AnalysisTaskLeaseMonitorOptions {
    task: ClaimedAnalysisTask
    abortController: AbortController
    checkIntervalMs: number
    renewalIntervalMs: number
    processingTimeoutMs: number
    leaseMs: number
    hasActiveLease: () => Promise<boolean>
    renewLease: (processingTimeoutSeconds: number, leaseSeconds: number) => Promise<boolean>
    clock: AnalysisTaskLeaseMonitorClock
    onState?: (active: boolean) => void
    onFailure: () => void
}

interface AnalysisTaskLeaseProbe {
    run: () => void
    wait: () => Promise<void>
}

function createAnalysisTaskLeaseProbe(
    canRun: () => boolean,
    operation: () => Promise<boolean>,
    onState: (active: boolean) => void,
    onFailure: () => void,
): AnalysisTaskLeaseProbe {
    let pending: Promise<void> | undefined
    return {
        run() {
            if (!canRun() || pending) return
            pending = operation()
                .then(onState)
                .catch(onFailure)
                .finally(() => {
                    pending = undefined
                })
        },
        async wait() {
            await pending
        },
    }
}

/** 监控并续期单次分析尝试持有的短租约。 */
export function startAnalysisTaskLeaseMonitor(
    options: AnalysisTaskLeaseMonitorOptions,
): () => Promise<void> {
    let stopped = false
    const handleLeaseState = (active: boolean) => {
        options.onState?.(active)
        if (!active && !options.abortController.signal.aborted) {
            options.abortController.abort(new AgentCancelledError('分析任务已由其他实例取消或回收'))
        }
    }
    const canRun = () => !stopped && !options.abortController.signal.aborted
    const checkProbe = createAnalysisTaskLeaseProbe(
        canRun,
        options.hasActiveLease,
        handleLeaseState,
        options.onFailure,
    )
    const renewalProbe = createAnalysisTaskLeaseProbe(
        canRun,
        () =>
            options.renewLease(
                Math.ceil(options.processingTimeoutMs / TIME_MS.SECOND),
                Math.ceil(options.leaseMs / TIME_MS.SECOND),
            ),
        handleLeaseState,
        options.onFailure,
    )
    const checkTimer = options.clock.setInterval(checkProbe.run, options.checkIntervalMs)
    const renewalTimer = options.clock.setInterval(renewalProbe.run, options.renewalIntervalMs)
    checkTimer.unref?.()
    renewalTimer.unref?.()

    return async () => {
        stopped = true
        options.clock.clearInterval(checkTimer)
        options.clock.clearInterval(renewalTimer)
        await Promise.all([checkProbe.wait(), renewalProbe.wait()])
    }
}
