import type { OnboardingChapterId, OnboardingEvent } from './onboarding.types'

export const onboardingReplayChapterIds = Object.freeze([
    'workspace_foundation',
    'agent_reply',
    'task_confirmation',
    'expert_mode',
    'analysis_result',
] as const satisfies readonly OnboardingChapterId[])

interface OnboardingChapterDefinition {
    readonly chapterId: OnboardingChapterId
    readonly guideId: string
    readonly priority: number
}

export const onboardingChapterCatalog = Object.freeze({
    workspace_foundation: {
        chapterId: 'workspace_foundation',
        guideId: 'onboarding.workspace-foundation.v2',
        priority: 10,
    },
    agent_reply: {
        chapterId: 'agent_reply',
        guideId: 'onboarding.agent-reply.v2',
        priority: 20,
    },
    task_confirmation: {
        chapterId: 'task_confirmation',
        guideId: 'onboarding.task-confirmation.v2',
        priority: 30,
    },
    expert_mode: {
        chapterId: 'expert_mode',
        guideId: 'onboarding.expert-mode.v2',
        priority: 40,
    },
    analysis_result: {
        chapterId: 'analysis_result',
        guideId: 'onboarding.analysis-result.v2',
        priority: 50,
    },
} satisfies Record<OnboardingChapterId, OnboardingChapterDefinition>)

export function chapterForOnboardingEvent(
    event: OnboardingEvent,
): OnboardingChapterDefinition {
    switch (event.type) {
        case 'workspace_ready':
            return onboardingChapterCatalog.workspace_foundation
        case 'agent_reply_presented':
            return onboardingChapterCatalog.agent_reply
        case 'task_confirmation_presented':
            return onboardingChapterCatalog.task_confirmation
        case 'expert_mode_entered':
            return onboardingChapterCatalog.expert_mode
        case 'analysis_result_revealed':
            return onboardingChapterCatalog.analysis_result
    }
}

export function onboardingEventIdentity(event: OnboardingEvent): string {
    switch (event.type) {
        case 'workspace_ready':
            return event.type
        case 'agent_reply_presented':
            return `${event.type}:${event.replyId}`
        case 'task_confirmation_presented':
            return `${event.type}:${event.confirmationId}`
        case 'expert_mode_entered':
            return `${event.type}:${event.entryId}`
        case 'analysis_result_revealed':
            return `${event.type}:${event.taskId}:${event.resultVersion}`
    }
}
