import {
    onBeforeUnmount,
    toValue,
    watch,
    type MaybeRefOrGetter,
} from 'vue'

import { useOnboardingCoordinator } from './onboarding.context'
import type {
    OnboardingBlockerKind,
    OnboardingBlockerLease,
} from './onboarding.types'

/** 用显式业务状态持有 blocker lease；不扫描 DOM 猜测弹窗或恢复状态。 */
export function useOnboardingBlocker(
    isActive: MaybeRefOrGetter<boolean>,
    kind: OnboardingBlockerKind,
): void {
    const coordinator = useOnboardingCoordinator()
    let lease: OnboardingBlockerLease | null = null

    watch(
        () => toValue(isActive),
        (active) => {
            if (active && !lease) {
                lease = coordinator.acquireBlocker(kind)
            } else if (!active && lease) {
                lease.release()
                lease = null
            }
        },
        { immediate: true },
    )

    onBeforeUnmount(() => {
        lease?.release()
        lease = null
    })
}
