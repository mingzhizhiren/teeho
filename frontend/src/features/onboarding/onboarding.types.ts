import type { GuideRunResult } from '../product-guide/productGuide.types'

export type OnboardingChapterId =
    | 'workspace_foundation'
    | 'agent_reply'
    | 'task_confirmation'
    | 'expert_mode'
    | 'analysis_result'

export type OnboardingEvent =
    | { type: 'workspace_ready' }
    | { type: 'agent_reply_presented'; replyId: string }
    | { type: 'task_confirmation_presented'; confirmationId: string }
    | { type: 'expert_mode_entered'; entryId: string }
    | { type: 'analysis_result_revealed'; taskId: string; resultVersion: number }

export type OnboardingBlockerKind =
    | 'business_dialog'
    | 'business_drawer'
    | 'workspace_recovery'
    | 'result_reveal'

export interface OnboardingBlockerLease {
    readonly id: string
    release(): void
}

export type OnboardingNotificationResult =
    | { status: 'queued' }
    | {
          status: 'ignored'
          reason:
              | 'account_required'
              | 'duplicate_event'
              | 'duplicate_chapter'
              | 'coordinator_destroyed'
      }

export type OnboardingReplayResult =
    | GuideRunResult
    | {
          status: 'unavailable'
          reason: 'page_inactive' | 'blocked' | 'target_unavailable'
      }

/** 业务 feature 只依赖真实事件、blocker lease 与受控重播三类接口。 */
export interface OnboardingCoordinator {
    notify(event: OnboardingEvent): OnboardingNotificationResult
    acquireBlocker(kind: OnboardingBlockerKind): OnboardingBlockerLease
    replay(chapterId: OnboardingChapterId): Promise<OnboardingReplayResult>
}

/** 仅供全局 Host 驱动浏览器环境和生命周期，不向业务 feature 暴露。 */
export interface OnboardingCoordinatorRuntime extends OnboardingCoordinator {
    refreshEnvironment(): void
    destroy(): void
}
