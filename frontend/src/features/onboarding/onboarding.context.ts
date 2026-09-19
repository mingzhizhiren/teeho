import { inject, type InjectionKey } from 'vue'

import type { OnboardingCoordinator } from './onboarding.types'

export const onboardingCoordinatorKey: InjectionKey<OnboardingCoordinator> =
    Symbol('onboarding-coordinator')

/** 业务 feature 获取的新手引导小型稳定 Interface。 */
export function useOnboardingCoordinator(): OnboardingCoordinator {
    const coordinator = inject(onboardingCoordinatorKey)
    if (!coordinator) throw new Error('新手引导协调 Module 尚未装配')
    return coordinator
}
