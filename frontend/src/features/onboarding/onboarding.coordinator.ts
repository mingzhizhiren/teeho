import type {
    GuideRunResult,
    ProductGuideModule,
} from '../product-guide/productGuide.types'
import {
    chapterForOnboardingEvent,
    onboardingChapterCatalog,
    onboardingEventIdentity,
} from './onboarding.catalog'
import type {
    OnboardingBlockerKind,
    OnboardingBlockerLease,
    OnboardingChapterId,
    OnboardingCoordinatorRuntime,
    OnboardingEvent,
    OnboardingNotificationResult,
    OnboardingReplayResult,
} from './onboarding.types'

interface OnboardingEnvironment {
    getAccountId(): string | null
    isPageVisible(): boolean
    hasPageFocus(): boolean
    canRunEvent(event: OnboardingEvent): boolean
    canReplayChapter(chapterId: OnboardingChapterId): boolean
}

interface OnboardingCoordinatorDependencies {
    runner: ProductGuideModule
    environment: OnboardingEnvironment
}

interface QueuedAutomaticRun {
    readonly accountId: string
    readonly event: OnboardingEvent
    readonly eventKey: string
    readonly chapterId: OnboardingChapterId
    readonly guideId: string
    readonly priority: number
    readonly sequence: number
}

interface ActiveRun {
    readonly id: number
    readonly kind: 'automatic' | 'manual'
    readonly accountId: string
    readonly queuedRun: QueuedAutomaticRun | null
}

function withValue<T>(values: ReadonlySet<T>, value: T): ReadonlySet<T> {
    return new Set([...values, value])
}

function withoutValue<T>(values: ReadonlySet<T>, value: T): ReadonlySet<T> {
    return new Set([...values].filter((candidate) => candidate !== value))
}

function sortQueue(queue: readonly QueuedAutomaticRun[]): QueuedAutomaticRun[] {
    return [...queue].sort(
        (left, right) => left.priority - right.priority || left.sequence - right.sequence,
    )
}

/** 创建集中管理真实事件、业务抢占和浏览器环境的新手引导协调 Module。 */
export function createOnboardingCoordinator(
    dependencies: OnboardingCoordinatorDependencies,
): OnboardingCoordinatorRuntime {
    let currentAccountId = dependencies.environment.getAccountId()
    let queue: readonly QueuedAutomaticRun[] = []
    let seenEventKeys: ReadonlySet<string> = new Set()
    let settledAutomaticChapters: ReadonlySet<OnboardingChapterId> = new Set()
    let blockerIds: ReadonlySet<string> = new Set()
    let interruptedRunIds: ReadonlySet<number> = new Set()
    let activeRun: ActiveRun | null = null
    let sequence = 0
    let runId = 0
    let blockerId = 0
    let isDestroyed = false
    const availabilityListeners = new Set<(available: boolean) => void>()
    let availabilityScheduled = false

    function publishAvailability(): void {
        if (availabilityScheduled) return
        availabilityScheduled = true
        queueMicrotask(() => {
            availabilityScheduled = false
            const available = !isDestroyed && !!currentAccountId && !activeRun && !queue.length && !blockerIds.size && pageCanRun()
            for (const listener of availabilityListeners) listener(available)
        })
    }

    function pageCanRun(): boolean {
        try {
            return (
                dependencies.environment.isPageVisible() &&
                dependencies.environment.hasPageFocus()
            )
        } catch {
            return false
        }
    }

    function queueRun(run: QueuedAutomaticRun): void {
        if (queue.some((candidate) => candidate.eventKey === run.eventKey)) return
        queue = sortQueue([...queue, run])
    }

    function destroyRunnerSafely(): void {
        try {
            dependencies.runner.destroy()
        } catch {
            // 产品引导永远不能阻断真实业务弹窗、账号切换或页面卸载。
        }
    }

    function interruptActive(shouldRequeue: boolean): void {
        const current = activeRun
        if (!current) return
        if (shouldRequeue && current.kind === 'automatic' && current.queuedRun) {
            queueRun(current.queuedRun)
        }
        interruptedRunIds = withValue(interruptedRunIds, current.id)
        destroyRunnerSafely()
    }

    function synchronizeAccount(): void {
        const nextAccountId = dependencies.environment.getAccountId()
        if (nextAccountId === currentAccountId) return
        interruptActive(false)
        currentAccountId = nextAccountId
        queue = []
        seenEventKeys = new Set()
        settledAutomaticChapters = new Set()
        blockerIds = new Set()
    }

    function finishAutomaticRun(
        id: number,
        run: QueuedAutomaticRun,
        result: GuideRunResult | null,
    ): void {
        const wasInterrupted = interruptedRunIds.has(id)
        if (wasInterrupted) interruptedRunIds = withoutValue(interruptedRunIds, id)
        if (
            !wasInterrupted &&
            result &&
            ['completed', 'skipped', 'suppressed'].includes(result.status)
        ) {
            settledAutomaticChapters = withValue(
                settledAutomaticChapters,
                run.chapterId,
            )
        }
        if (activeRun?.id === id) activeRun = null
        drain()
    }

    function startAutomaticRun(run: QueuedAutomaticRun): void {
        const id = ++runId
        activeRun = {
            id,
            kind: 'automatic',
            accountId: run.accountId,
            queuedRun: run,
        }
        let result: ReturnType<ProductGuideModule['startGuide']>
        try {
            result = dependencies.runner.startGuide(run.guideId, {
                intent: 'automatic',
            })
        } catch {
            activeRun = null
            drain()
            return
        }
        void result.then(
            (outcome) => finishAutomaticRun(id, run, outcome),
            () => finishAutomaticRun(id, run, null),
        )
    }

    function drain(): void {
        publishAvailability()
        if (isDestroyed) return
        synchronizeAccount()
        if (
            activeRun ||
            !currentAccountId ||
            blockerIds.size > 0 ||
            !pageCanRun()
        ) {
            return
        }

        while (queue.length > 0) {
            const [next, ...remaining] = queue
            queue = remaining
            if (!next || next.accountId !== currentAccountId) continue
            try {
                if (!dependencies.environment.canRunEvent(next.event)) continue
            } catch {
                continue
            }
            startAutomaticRun(next)
            return
        }
    }

    function notify(event: OnboardingEvent): OnboardingNotificationResult {
        if (isDestroyed) {
            return { status: 'ignored', reason: 'coordinator_destroyed' }
        }
        synchronizeAccount()
        if (!currentAccountId) return { status: 'ignored', reason: 'account_required' }
        const identity = onboardingEventIdentity(event)
        const eventKey = `${currentAccountId}:${identity}`
        if (seenEventKeys.has(eventKey)) {
            return { status: 'ignored', reason: 'duplicate_event' }
        }
        const chapter = chapterForOnboardingEvent(event)
        if (
            settledAutomaticChapters.has(chapter.chapterId) ||
            queue.some((candidate) => candidate.chapterId === chapter.chapterId) ||
            activeRun?.queuedRun?.chapterId === chapter.chapterId
        ) {
            return { status: 'ignored', reason: 'duplicate_chapter' }
        }
        seenEventKeys = withValue(seenEventKeys, eventKey)
        queueRun({
            accountId: currentAccountId,
            event,
            eventKey,
            chapterId: chapter.chapterId,
            guideId: chapter.guideId,
            priority: chapter.priority,
            sequence: ++sequence,
        })
        drain()
        return { status: 'queued' }
    }

    function acquireBlocker(kind: OnboardingBlockerKind): OnboardingBlockerLease {
        publishAvailability()
        const id = `onboarding-blocker-${kind}-${++blockerId}`
        blockerIds = withValue(blockerIds, id)
        interruptActive(true)
        let isReleased = false
        return {
            id,
            release() {
                if (isReleased) return
                isReleased = true
                blockerIds = withoutValue(blockerIds, id)
                drain()
            },
        }
    }

    async function replay(
        chapterId: OnboardingChapterId,
    ): Promise<OnboardingReplayResult> {
        if (isDestroyed) {
            return { status: 'unavailable', reason: 'driver_unavailable' }
        }
        synchronizeAccount()
        if (!currentAccountId) {
            return { status: 'unavailable', reason: 'account_required' }
        }
        if (!pageCanRun()) return { status: 'unavailable', reason: 'page_inactive' }
        if (blockerIds.size > 0 || activeRun) {
            return { status: 'unavailable', reason: 'blocked' }
        }
        try {
            if (!dependencies.environment.canReplayChapter(chapterId)) {
                return { status: 'unavailable', reason: 'target_unavailable' }
            }
        } catch {
            return { status: 'unavailable', reason: 'target_unavailable' }
        }

        const currentRunId = ++runId
        publishAvailability()
        activeRun = {
            id: currentRunId,
            kind: 'manual',
            accountId: currentAccountId,
            queuedRun: null,
        }
        try {
            return await dependencies.runner.startGuide(
                onboardingChapterCatalog[chapterId].guideId,
                { intent: 'manual_replay' },
            )
        } finally {
            interruptedRunIds = withoutValue(interruptedRunIds, currentRunId)
            if (activeRun?.id === currentRunId) activeRun = null
            drain()
        }
    }

    function refreshEnvironment(): void {
        publishAvailability()
        if (isDestroyed) return
        synchronizeAccount()
        if (activeRun && !pageCanRun()) {
            interruptActive(activeRun.kind === 'automatic')
            return
        }
        drain()
    }

    return {
        tryAcquireIdleBlocker(kind) {
            synchronizeAccount()
            if (isDestroyed || !currentAccountId || activeRun || queue.length || blockerIds.size || !pageCanRun()) return null
            return acquireBlocker(kind)
        },
        subscribeAvailability(listener) {
            availabilityListeners.add(listener)
            publishAvailability()
            return () => { availabilityListeners.delete(listener) }
        },
        notify,
        acquireBlocker,
        replay,
        refreshEnvironment,
        destroy() {
            if (isDestroyed) return
            isDestroyed = true
            publishAvailability()
            queue = []
            seenEventKeys = new Set()
            settledAutomaticChapters = new Set()
            blockerIds = new Set()
            interruptActive(false)
            if (!activeRun) destroyRunnerSafely()
        },
    }
}
