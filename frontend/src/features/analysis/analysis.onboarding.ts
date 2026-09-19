import type { OnboardingCoordinator } from '../onboarding/onboarding.types'

type AnalysisOnboardingEventOrigin = 'new' | 'restored'

interface PresentedAgentReplyEvent {
    replyId: string
    origin: AnalysisOnboardingEventOrigin
    targetsReady: boolean
}

interface PresentedTaskConfirmationEvent {
    confirmationId: string
    origin: AnalysisOnboardingEventOrigin
    targetsReady: boolean
}

interface PresentedExpertModeEvent {
    entryId: string
    origin: AnalysisOnboardingEventOrigin
    targetsReady: boolean
}

interface PresentedAnalysisResultEvent {
    taskId: string
    resultVersion: number
    origin: AnalysisOnboardingEventOrigin
    targetsReady: boolean
}

/** 业务状态到新手引导真实事件的唯一 Adapter；恢复展示永远不伪装成新事实。 */
export function createAnalysisOnboardingEventReporter(coordinator: OnboardingCoordinator) {
    return {
        reportAgentReply(event: PresentedAgentReplyEvent): void {
            if (event.origin !== 'new' || !event.targetsReady) return
            coordinator.notify({
                type: 'agent_reply_presented',
                replyId: event.replyId,
            })
        },
        reportTaskConfirmation(event: PresentedTaskConfirmationEvent): void {
            if (event.origin !== 'new' || !event.targetsReady) return
            coordinator.notify({
                type: 'task_confirmation_presented',
                confirmationId: event.confirmationId,
            })
        },
        reportExpertMode(event: PresentedExpertModeEvent): void {
            if (event.origin !== 'new' || !event.targetsReady) return
            coordinator.notify({
                type: 'expert_mode_entered',
                entryId: event.entryId,
            })
        },
        reportAnalysisResult(event: PresentedAnalysisResultEvent): void {
            if (event.origin !== 'new' || !event.targetsReady) return
            coordinator.notify({
                type: 'analysis_result_revealed',
                taskId: event.taskId,
                resultVersion: event.resultVersion,
            })
        },
    }
}
