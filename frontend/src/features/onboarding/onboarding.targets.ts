import { findGuideAnchor } from '../product-guide/productGuide.anchor'
import { SHOW_RADAR_REPORT } from '@/utils/reportPresentation'
import type { OnboardingChapterId } from './onboarding.types'

export const onboardingChapterAnchorIds = Object.freeze({
    workspace_foundation: [
        'onboarding.workspace.mode',
        'onboarding.workspace.options',
        'onboarding.workspace.agent-input',
    ],
    agent_reply: ['onboarding.agent-reply.region', 'onboarding.agent-reply.free-input'],
    task_confirmation: ['onboarding.task-confirmation.card'],
    expert_mode: [
        'onboarding.expert-mode.options',
        'onboarding.expert-mode.core-fields',
        'onboarding.expert-mode.media',
        'onboarding.expert-mode.start-analysis',
    ],
    analysis_result: [
        ...(SHOW_RADAR_REPORT ? ['onboarding.analysis-result.metrics'] : []),
        'onboarding.analysis-result.report',
        'onboarding.analysis-result.actions',
    ],
} satisfies Record<OnboardingChapterId, readonly string[]>)

/** 只通过已注册语义锚点确认当前真实业务上下文，不制造模拟目标。 */
export function isOnboardingChapterTargetAvailable(
    document: Document,
    chapterId: OnboardingChapterId,
): boolean {
    const anchorIds = onboardingChapterAnchorIds[chapterId]
    return (
        anchorIds.length > 0 &&
        anchorIds.every((anchorId) => Boolean(findGuideAnchor(document, anchorId)))
    )
}
