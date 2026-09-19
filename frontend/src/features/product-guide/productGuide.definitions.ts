import type { GuideDefinition } from './productGuide.types'
import { SHOW_RADAR_REPORT } from '@/utils/reportPresentation'

/** 随当前前端发布的生产引导；语义变化通过 guide ID 版本显式升级。 */
const allProductGuideDefinitions: GuideDefinition[] = [
    {
        id: 'onboarding.workspace-foundation.v2',
        steps: [
            {
                id: 'welcome',
                routeName: 'workspace',
                titleKey: 'productGuide.onboarding.workspaceFoundation.steps.welcome.title',
                contentKey: 'productGuide.onboarding.workspaceFoundation.steps.welcome.content',
                placement: 'center',
                interaction: 'highlight_only',
            },
            {
                id: 'mode-choice',
                routeName: 'workspace',
                anchorId: 'onboarding.workspace.mode',
                titleKey: 'productGuide.onboarding.workspaceFoundation.steps.modeChoice.title',
                contentKey: 'productGuide.onboarding.workspaceFoundation.steps.modeChoice.content',
                placement: 'bottom',
                interaction: 'highlight_only',
            },
            {
                id: 'task-options',
                routeName: 'workspace',
                anchorId: 'onboarding.workspace.options',
                titleKey: 'productGuide.onboarding.workspaceFoundation.steps.taskOptions.title',
                contentKey: 'productGuide.onboarding.workspaceFoundation.steps.taskOptions.content',
                placement: 'top',
                interaction: 'highlight_only',
            },
            {
                id: 'agent-input',
                routeName: 'workspace',
                anchorId: 'onboarding.workspace.agent-input',
                titleKey: 'productGuide.onboarding.workspaceFoundation.steps.agentInput.title',
                contentKey: 'productGuide.onboarding.workspaceFoundation.steps.agentInput.content',
                placement: 'top',
                interaction: 'highlight_only',
            },
        ],
    },
    {
        id: 'onboarding.agent-reply.v2',
        steps: [
            {
                id: 'reply-region',
                routeName: 'workspace',
                anchorId: 'onboarding.agent-reply.region',
                titleKey: 'productGuide.onboarding.agentReply.steps.replyRegion.title',
                contentKey: 'productGuide.onboarding.agentReply.steps.replyRegion.content',
                placement: 'bottom',
                interaction: 'highlight_only',
            },
            {
                id: 'free-input',
                routeName: 'workspace',
                anchorId: 'onboarding.agent-reply.free-input',
                titleKey: 'productGuide.onboarding.agentReply.steps.freeInput.title',
                contentKey: 'productGuide.onboarding.agentReply.steps.freeInput.content',
                placement: 'top',
                interaction: 'highlight_only',
            },
        ],
    },
    {
        id: 'onboarding.task-confirmation.v2',
        steps: [
            {
                id: 'confirmation-card',
                routeName: 'workspace',
                anchorId: 'onboarding.task-confirmation.card',
                titleKey: 'productGuide.onboarding.taskConfirmation.steps.card.title',
                contentKey: 'productGuide.onboarding.taskConfirmation.steps.card.content',
                placement: 'bottom',
                interaction: 'click_to_advance',
            },
            {
                id: 'key-fields',
                routeName: 'workspace',
                anchorId: 'onboarding.task-confirmation.key-fields',
                titleKey: 'productGuide.onboarding.taskConfirmation.steps.keyFields.title',
                contentKey: 'productGuide.onboarding.taskConfirmation.steps.keyFields.content',
                placement: 'bottom',
                interaction: 'highlight_only',
            },
            {
                id: 'start-analysis',
                routeName: 'workspace',
                anchorId: 'onboarding.task-confirmation.start-analysis',
                titleKey: 'productGuide.onboarding.taskConfirmation.steps.startAnalysis.title',
                contentKey: 'productGuide.onboarding.taskConfirmation.steps.startAnalysis.content',
                placement: 'top',
                interaction: 'highlight_only',
            },
        ],
    },
    {
        id: 'onboarding.expert-mode.v2',
        steps: [
            {
                id: 'task-options',
                routeName: 'workspace',
                anchorId: 'onboarding.expert-mode.options',
                titleKey: 'productGuide.onboarding.expertMode.steps.taskOptions.title',
                contentKey: 'productGuide.onboarding.expertMode.steps.taskOptions.content',
                placement: 'bottom',
                interaction: 'highlight_only',
            },
            {
                id: 'core-fields',
                routeName: 'workspace',
                anchorId: 'onboarding.expert-mode.core-fields',
                titleKey: 'productGuide.onboarding.expertMode.steps.coreFields.title',
                contentKey: 'productGuide.onboarding.expertMode.steps.coreFields.content',
                placement: 'bottom',
                interaction: 'highlight_only',
            },
            {
                id: 'media',
                routeName: 'workspace',
                anchorId: 'onboarding.expert-mode.media',
                titleKey: 'productGuide.onboarding.expertMode.steps.media.title',
                contentKey: 'productGuide.onboarding.expertMode.steps.media.content',
                placement: 'top',
                interaction: 'highlight_only',
            },
            {
                id: 'start-analysis',
                routeName: 'workspace',
                anchorId: 'onboarding.expert-mode.start-analysis',
                titleKey: 'productGuide.onboarding.expertMode.steps.startAnalysis.title',
                contentKey: 'productGuide.onboarding.expertMode.steps.startAnalysis.content',
                placement: 'top',
                interaction: 'highlight_only',
            },
        ],
    },
    {
        id: 'onboarding.analysis-result.v2',
        steps: [
            {
                id: 'metrics-and-level',
                routeName: 'workspace',
                anchorId: 'onboarding.analysis-result.metrics',
                titleKey: 'productGuide.onboarding.analysisResult.steps.metrics.title',
                contentKey: 'productGuide.onboarding.analysisResult.steps.metrics.content',
                placement: 'bottom',
                interaction: 'highlight_only',
            },
            {
                id: 'report',
                routeName: 'workspace',
                anchorId: 'onboarding.analysis-result.report',
                titleKey: 'productGuide.onboarding.analysisResult.steps.report.title',
                contentKey: 'productGuide.onboarding.analysisResult.steps.report.content',
                placement: 'top',
                interaction: 'highlight_only',
            },
            {
                id: 'result-actions',
                routeName: 'workspace',
                anchorId: 'onboarding.analysis-result.actions',
                titleKey: 'productGuide.onboarding.analysisResult.steps.actions.title',
                contentKey: 'productGuide.onboarding.analysisResult.steps.actions.content',
                placement: 'bottom',
                interaction: 'highlight_only',
            },
        ],
    },
]

/** 暂时跳过已隐藏的雷达图引导，保留其余报告引导。 */
export const productGuideDefinitions: GuideDefinition[] = allProductGuideDefinitions.map((guide) => ({
    ...guide,
    steps: guide.steps.filter(
        (step) => SHOW_RADAR_REPORT || step.anchorId !== 'onboarding.analysis-result.metrics',
    ),
}))
