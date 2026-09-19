import type { DriveStep, Driver, PopoverDOM } from 'driver.js'

import { findGuideAnchor } from './productGuide.anchor'
import {
    canAdvanceFromGuideTargetClick,
    resolveGuideKeyboardAction,
    resolveGuideSwipe,
} from './productGuide.controls'
import type {
    GuideStepPreparation,
    ProductGuideDriver,
    ProductGuideDriverRun,
    ResolvedGuideStep,
} from './productGuide.types'

interface GuideDriveStepLabels {
    unavailableMessage: string
    skipStepLabel: string
}

interface TouchPoint {
    x: number
    y: number
}

type DriverFactory = (typeof import('driver.js'))['driver']

/** Driver.js Adapter 的浏览器依赖注入选项。 */
export interface DriverJsAdapterOptions {
    loadDriver?: () => Promise<{ driver: DriverFactory }>
    prefersReducedMotion?: () => boolean
}

const focusableSelector = [
    'button:not([disabled])',
    'a[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',')

function systemPrefersReducedMotion(): boolean {
    return (
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
}

function escapeText(value: string): string {
    return value
        .replace(/&/gu, '&amp;')
        .replace(/</gu, '&lt;')
        .replace(/>/gu, '&gt;')
        .replace(/"/gu, '&quot;')
        .replace(/'/gu, '&#039;')
}

/** 把受控步骤定义投影为 Driver.js 配置；不可用目标只显示居中跳过卡片。 */
export function createGuideDriveStep(
    step: ResolvedGuideStep,
    preparation: GuideStepPreparation,
    labels: GuideDriveStepLabels,
): DriveStep {
    const isUnavailable = preparation.status === 'unavailable'
    const side = isUnavailable || step.placement === 'center' ? undefined : step.placement
    return {
        element:
            !isUnavailable && step.anchorId
                ? () => findGuideAnchor(document, step.anchorId!) as Element
                : undefined,
        disableActiveInteraction: isUnavailable || step.interaction === 'highlight_only',
        // 点击推进由 adapter 监听真实 click，不能让 Driver 模拟或绕过进度回调。
        advanceOnClick: false,
        popover: {
            title: escapeText(step.title),
            description: escapeText(isUnavailable ? labels.unavailableMessage : step.content),
            side,
            showButtons:
                step.interaction === 'click_to_advance'
                    ? ['previous', 'close']
                    : ['previous', 'next', 'close'],
            ...(isUnavailable ? { nextBtnText: labels.skipStepLabel } : {}),
        },
        data: { stepId: step.id, unavailable: isUnavailable },
    }
}

function activeStepId(driverInstance: Driver): string | null {
    const value = driverInstance.getActiveStep()?.data?.stepId
    return typeof value === 'string' ? value : null
}

function focusableElements(root: Element | null): HTMLElement[] {
    if (!root) return []
    const HTMLElementConstructor = document.defaultView?.HTMLElement
    if (!HTMLElementConstructor) return []
    const elements = [...root.querySelectorAll<HTMLElement>(focusableSelector)]
    return root instanceof HTMLElementConstructor && root.matches(focusableSelector)
        ? [root as HTMLElement, ...elements]
        : elements
}

function moveGuideFocus(
    popover: PopoverDOM | null,
    backwards: boolean,
    interactiveTarget: Element | null,
): boolean {
    if (!popover) return false
    const controls = [
        ...focusableElements(popover.wrapper),
        ...focusableElements(interactiveTarget),
    ]
    if (controls.length === 0) return false
    const currentIndex = controls.findIndex((control) => control === document.activeElement)
    const nextIndex = backwards
        ? currentIndex <= 0
            ? controls.length - 1
            : currentIndex - 1
        : currentIndex < 0 || currentIndex >= controls.length - 1
          ? 0
          : currentIndex + 1
    controls[nextIndex]?.focus()
    return true
}

/** 创建浏览器专用 Driver.js adapter；模块导入本身不访问 DOM。 */
export function createDriverJsAdapter(options: DriverJsAdapterOptions = {}): ProductGuideDriver {
    let driverInstance: Driver | null = null
    let activeController: AbortController | null = null
    let settleActiveRun: ((status: 'completed' | 'skipped') => void) | null = null

    async function run(input: ProductGuideDriverRun): Promise<'completed' | 'skipped'> {
        if (typeof document === 'undefined') return 'skipped'
        if (input.steps.length === 0) return 'completed'
        activeController?.abort()
        const controller = new AbortController()
        activeController = controller
        const HTMLElementConstructor = document.defaultView?.HTMLElement
        const previouslyFocused =
            HTMLElementConstructor && document.activeElement instanceof HTMLElementConstructor
                ? document.activeElement
                : null
        try {
            const { driver } = await (options.loadDriver?.() ?? import('driver.js'))
            if (controller.signal.aborted) return 'skipped'
            const initialPreparation = await input.prepareStep(input.steps[input.startIndex]!)
            let preparations = input.steps.map<GuideStepPreparation>((_step, index) =>
                index === input.startIndex ? initialPreparation : { status: 'ready' },
            )
            if (controller.signal.aborted) return 'skipped'
            let driveSteps = input.steps.map((step, index) =>
                createGuideDriveStep(step, preparations[index]!, {
                    unavailableMessage:
                        preparations[index]!.status === 'unavailable'
                            ? input.unavailableMessage(preparations[index]!.reason)
                            : '',
                    skipStepLabel: input.skipStepLabel,
                }),
            )

            return await new Promise((resolve) => {
                let isSettled = false
                let isTransitioning = false
                let currentPopover: PopoverDOM | null = null
                let removeTargetClick: (() => void) | null = null
                let removeTouchControls: (() => void) | null = null
                let progressCallbacks: Promise<void> = Promise.resolve()

                const cleanupTargetClick = () => {
                    removeTargetClick?.()
                    removeTargetClick = null
                }
                const cleanup = () => {
                    cleanupTargetClick()
                    removeTouchControls?.()
                    removeTouchControls = null
                    document.removeEventListener('keydown', onKeyDown, true)
                    currentPopover = null
                    if (previouslyFocused?.isConnected) previouslyFocused.focus()
                }
                const settle = (status: 'completed' | 'skipped') => {
                    if (isSettled) return
                    isSettled = true
                    if (settleActiveRun === settle) settleActiveRun = null
                    cleanup()
                    progressCallbacks.then(
                        () => resolve(status),
                        () => resolve('skipped'),
                    )
                }
                settleActiveRun = settle
                const prepareIndex = async (index: number) => {
                    const step = input.steps[index]
                    if (!step) return
                    const preparation = await input.prepareStep(step)
                    preparations = preparations.map((candidate, candidateIndex) =>
                        candidateIndex === index ? preparation : candidate,
                    )
                    const replacement = createGuideDriveStep(step, preparation, {
                        unavailableMessage:
                            preparation.status === 'unavailable'
                                ? input.unavailableMessage(preparation.reason)
                                : '',
                        skipStepLabel: input.skipStepLabel,
                    })
                    driveSteps = driveSteps.map((candidate, candidateIndex) =>
                        candidateIndex === index ? replacement : candidate,
                    )
                    if (driverInstance) {
                        driverInstance.setConfig({
                            ...driverInstance.getConfig(),
                            steps: driveSteps,
                        })
                    }
                }
                const transition = (operation: () => Promise<void>) => {
                    if (isTransitioning || isSettled) return
                    isTransitioning = true
                    void operation()
                        .catch(() => {
                            settle('skipped')
                            driverInstance?.destroy()
                        })
                        .finally(() => {
                            isTransitioning = false
                        })
                }
                const completeAndAdvance = async () => {
                    const activeIndex = driverInstance?.getActiveIndex() ?? input.startIndex
                    const stepId = activeStepId(driverInstance!)
                    if (stepId) {
                        progressCallbacks = progressCallbacks.then(() =>
                            input.onStepCompleted(stepId),
                        )
                        await progressCallbacks
                    }
                    if (activeIndex >= input.steps.length - 1) {
                        settle('completed')
                        driverInstance?.destroy()
                        return
                    }
                    await prepareIndex(activeIndex + 1)
                    if (!isSettled) driverInstance?.moveNext()
                }
                const movePrevious = async () => {
                    const activeIndex = driverInstance?.getActiveIndex() ?? input.startIndex
                    if (activeIndex <= 0) return
                    await prepareIndex(activeIndex - 1)
                    if (!isSettled) driverInstance?.movePrevious()
                }
                const attachTargetClick = () => {
                    cleanupTargetClick()
                    const activeIndex = driverInstance?.getActiveIndex()
                    if (activeIndex === undefined) return
                    const step = input.steps[activeIndex]
                    const preparation = preparations[activeIndex]
                    const element = driverInstance?.getActiveElement()
                    if (
                        !step ||
                        !element ||
                        step.interaction !== 'click_to_advance' ||
                        preparation?.status !== 'ready'
                    ) {
                        return
                    }
                    const onClick = (event: Event) => {
                        if (!canAdvanceFromGuideTargetClick(event)) return
                        cleanupTargetClick()
                        transition(completeAndAdvance)
                    }
                    element.addEventListener('click', onClick)
                    removeTargetClick = () => element.removeEventListener('click', onClick)
                }
                const attachTouchControls = (popover: PopoverDOM) => {
                    removeTouchControls?.()
                    let startPoint: TouchPoint | null = null
                    const onTouchStart = (event: TouchEvent) => {
                        const touch = event.touches[0]
                        startPoint = touch ? { x: touch.clientX, y: touch.clientY } : null
                    }
                    const onTouchEnd = (event: TouchEvent) => {
                        const touch = event.changedTouches[0]
                        if (!startPoint || !touch) return
                        const action = resolveGuideSwipe({
                            startX: startPoint.x,
                            startY: startPoint.y,
                            endX: touch.clientX,
                            endY: touch.clientY,
                        })
                        startPoint = null
                        if (!action) return
                        event.preventDefault()
                        transition(action === 'next' ? completeAndAdvance : movePrevious)
                    }
                    popover.wrapper.addEventListener('touchstart', onTouchStart, { passive: true })
                    popover.wrapper.addEventListener('touchend', onTouchEnd, { passive: false })
                    removeTouchControls = () => {
                        popover.wrapper.removeEventListener('touchstart', onTouchStart)
                        popover.wrapper.removeEventListener('touchend', onTouchEnd)
                    }
                }
                function onKeyDown(event: KeyboardEvent) {
                    const action = resolveGuideKeyboardAction(event)
                    if (!action) return
                    if (action === 'focus_next' || action === 'focus_previous') {
                        const activeIndex = driverInstance?.getActiveIndex()
                        const step =
                            activeIndex === undefined ? undefined : input.steps[activeIndex]
                        const preparation =
                            activeIndex === undefined ? undefined : preparations[activeIndex]
                        const interactiveTarget =
                            step?.interaction !== 'highlight_only' &&
                            preparation?.status === 'ready'
                                ? (driverInstance?.getActiveElement() ?? null)
                                : null
                        if (
                            moveGuideFocus(
                                currentPopover,
                                action === 'focus_previous',
                                interactiveTarget,
                            )
                        ) {
                            event.preventDefault()
                            event.stopImmediatePropagation()
                        }
                        return
                    }
                    event.preventDefault()
                    event.stopImmediatePropagation()
                    if (action === 'close') {
                        settle('skipped')
                        driverInstance?.destroy()
                    } else {
                        transition(action === 'next' ? completeAndAdvance : movePrevious)
                    }
                }

                const shouldReduceMotion =
                    options.prefersReducedMotion?.() ?? systemPrefersReducedMotion()
                driverInstance = driver({
                    steps: driveSteps,
                    animate: !shouldReduceMotion,
                    smoothScroll: !shouldReduceMotion,
                    showProgress: true,
                    nextBtnText: input.nextLabel,
                    prevBtnText: input.previousLabel,
                    doneBtnText: input.doneLabel,
                    allowClose: false,
                    allowKeyboardControl: false,
                    overlayClickBehavior: () => undefined,
                    popoverClass: 'teeho-product-guide',
                    onPopoverRender: (popover) => {
                        currentPopover = popover
                        const stepId = activeStepId(driverInstance!) ?? 'active'
                        popover.title.id = `teeho-product-guide-title-${stepId}`
                        popover.description.id = `teeho-product-guide-description-${stepId}`
                        popover.title.setAttribute('role', 'heading')
                        popover.title.setAttribute('aria-level', '2')
                        popover.wrapper.setAttribute('role', 'dialog')
                        const activeIndex = driverInstance?.getActiveIndex()
                        const step =
                            activeIndex === undefined ? undefined : input.steps[activeIndex]
                        const preparation =
                            activeIndex === undefined ? undefined : preparations[activeIndex]
                        if (
                            step?.interaction !== 'highlight_only' &&
                            preparation?.status === 'ready'
                        ) {
                            popover.wrapper.removeAttribute('aria-modal')
                        } else {
                            popover.wrapper.setAttribute('aria-modal', 'true')
                        }
                        popover.wrapper.setAttribute('aria-labelledby', popover.title.id)
                        popover.wrapper.setAttribute('aria-describedby', popover.description.id)
                        popover.closeButton.setAttribute('aria-label', input.closeLabel)
                        attachTouchControls(popover)
                        queueMicrotask(() => {
                            if (isSettled) return
                            if (step?.interaction === 'click_to_advance') {
                                const target = driverInstance?.getActiveElement()
                                if (target instanceof HTMLElement) {
                                    target.focus()
                                    return
                                }
                            }
                            popover.nextButton.focus()
                        })
                    },
                    onHighlighted: () => {
                        const stepId = activeStepId(driverInstance!)
                        if (stepId) {
                            progressCallbacks = progressCallbacks.then(() =>
                                input.onStepEntered(stepId),
                            )
                        }
                        attachTargetClick()
                    },
                    onDeselected: cleanupTargetClick,
                    onNextClick: () => transition(completeAndAdvance),
                    onDoneClick: () => transition(completeAndAdvance),
                    onPrevClick: () => transition(movePrevious),
                    onCloseClick: () => {
                        settle('skipped')
                        driverInstance?.destroy()
                    },
                    onDestroyed: () => settle('skipped'),
                })
                document.addEventListener('keydown', onKeyDown, true)
                driverInstance.drive(input.startIndex)
            })
        } finally {
            if (activeController === controller) activeController = null
        }
    }

    return {
        run,
        destroy: () => {
            activeController?.abort()
            settleActiveRun?.('skipped')
            driverInstance?.destroy()
            driverInstance = null
            activeController = null
            settleActiveRun = null
        },
    }
}
