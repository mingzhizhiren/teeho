import { isNavigationFailure, type Router } from 'vue-router'

import { findGuideAnchor } from './productGuide.anchor'
import type { ProductGuideStepPreparer, ResolvedGuideStep } from './productGuide.types'

/** 跨页面步骤等待语义锚点的统一上限。 */
export const PRODUCT_GUIDE_ANCHOR_WAIT_MS = 4_000

type WaitForAnchor = (anchorId: string, timeoutMs: number, signal: AbortSignal) => Promise<boolean>

/** 跨页步骤准备器的可测试浏览器依赖。 */
export interface ProductGuideNavigationOptions {
    waitForAnchor?: WaitForAnchor
    anchorWaitMs?: number
}

/** 等待异步页面注册语义锚点，并在每条终态路径清理计时器与 Observer。 */
export function waitForGuideAnchor(
    anchorId: string,
    timeoutMs = PRODUCT_GUIDE_ANCHOR_WAIT_MS,
    signal: AbortSignal = new AbortController().signal,
): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false)
    if (typeof document === 'undefined') return Promise.resolve(false)
    if (findGuideAnchor(document, anchorId)) return Promise.resolve(true)
    const Observer = document.defaultView?.MutationObserver ?? globalThis.MutationObserver
    if (!Observer) return Promise.resolve(false)

    return new Promise((resolve) => {
        let isSettled = false
        const settle = (found: boolean) => {
            if (isSettled) return
            isSettled = true
            clearTimeout(timer)
            observer.disconnect()
            signal.removeEventListener('abort', onAbort)
            resolve(found)
        }
        const onAbort = () => settle(false)
        const observer = new Observer(() => {
            if (findGuideAnchor(document, anchorId)) settle(true)
        })
        const timer = setTimeout(() => settle(false), timeoutMs)
        signal.addEventListener('abort', onAbort, { once: true })
        observer.observe(document.documentElement, { childList: true, subtree: true })
    })
}

/** Vue Router 跨页步骤准备器；所有导航都通过 Router，因此守卫具有最终决定权。 */
export function createVueRouterGuideStepPreparer(
    router: Router,
    options: ProductGuideNavigationOptions = {},
): ProductGuideStepPreparer {
    const waitForAnchor = options.waitForAnchor ?? waitForGuideAnchor
    const anchorWaitMs = options.anchorWaitMs ?? PRODUCT_GUIDE_ANCHOR_WAIT_MS
    let activeController: AbortController | null = null

    return {
        async prepare(step: ResolvedGuideStep) {
            activeController?.abort()
            const controller = new AbortController()
            activeController = controller
            if (step.routeName && router.currentRoute.value.name !== step.routeName) {
                try {
                    const failure = await router.push({ name: step.routeName })
                    if (
                        isNavigationFailure(failure) ||
                        router.currentRoute.value.name !== step.routeName
                    ) {
                        return { status: 'unavailable', reason: 'navigation_failed' }
                    }
                } catch {
                    return { status: 'unavailable', reason: 'navigation_failed' }
                }
            }

            if (
                step.anchorId &&
                !(await waitForAnchor(step.anchorId, anchorWaitMs, controller.signal))
            ) {
                return { status: 'unavailable', reason: 'anchor_missing' }
            }
            return { status: 'ready' }
        },
        destroy: () => {
            activeController?.abort()
            activeController = null
        },
    }
}
