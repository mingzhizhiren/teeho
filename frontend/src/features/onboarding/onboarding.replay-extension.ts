import type { InjectionKey } from 'vue'

/** 工作区扩展章节；先标记手动重播，再关闭账户菜单并取得引导租约。 */
export interface OnboardingReplayEntry {
    readonly id: string
    readonly titleKey: string
    available(): boolean
    replay(beforeStart: () => Promise<void>): Promise<boolean>
}

/** 仅在当前工作区提供，不共享账号、页面或 SSR 请求间的运行状态。 */
export const onboardingReplayEntriesKey: InjectionKey<readonly OnboardingReplayEntry[]> = Symbol(
    'onboarding-replay-entries',
)
