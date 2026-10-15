import type { GuideDefinition } from './productGuide.types'
import { SHOW_RADAR_REPORT } from '@/utils/reportPresentation'

const templateSteps: GuideDefinition['steps'] = [
    {
        id: 'copy-template',
        routeName: 'workspace',
        anchorId: 'onboarding.expert-mode.copy-template',
        titleKey: 'productGuide.onboarding.template.copy.title',
        contentKey: 'productGuide.onboarding.template.copy.content',
        placement: 'top',
        interaction: 'highlight_only',
    },
    {
        id: 'paste-content',
        routeName: 'workspace',
        anchorId: 'onboarding.expert-mode.paste-content',
        titleKey: 'productGuide.onboarding.template.paste.title',
        contentKey: 'productGuide.onboarding.template.paste.content',
        placement: 'top',
        interaction: 'highlight_only',
    },
]

/** 随当前前端发布的生产引导；语义变化通过 guide ID 版本显式升级。 */
const allProductGuideDefinitions: GuideDefinition[] = [
    {
        id: 'onboarding.workspace-foundation.v4',
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
                id: 'content-kind',
                routeName: 'workspace',
                anchorId: 'onboarding.expert-mode.options',
                titleKey: 'productGuide.onboarding.workspaceFoundation.steps.modeChoice.title',
                contentKey: 'productGuide.onboarding.workspaceFoundation.steps.modeChoice.content',
                placement: 'bottom',
                interaction: 'highlight_only',
            },
            {
                id: 'task-options',
                routeName: 'workspace',
                anchorId: 'onboarding.expert-mode.media',
                titleKey: 'productGuide.onboarding.workspaceFoundation.steps.taskOptions.title',
                contentKey: 'productGuide.onboarding.workspaceFoundation.steps.taskOptions.content',
                placement: 'top',
                interaction: 'highlight_only',
            },
            {
                id: 'note-fields',
                routeName: 'workspace',
                anchorId: 'onboarding.expert-mode.core-fields',
                titleKey: 'productGuide.onboarding.workspaceFoundation.steps.agentInput.title',
                contentKey: 'productGuide.onboarding.workspaceFoundation.steps.agentInput.content',
                placement: 'top',
                interaction: 'highlight_only',
            },
            ...templateSteps,
        ],
    },
    {
        id: 'onboarding.expert-mode.v3',
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
            ...templateSteps,
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
export const productGuideDefinitions: GuideDefinition[] = allProductGuideDefinitions.map(
    (guide) => ({
        ...guide,
        steps: guide.steps.filter(
            (step) => SHOW_RADAR_REPORT || step.anchorId !== 'onboarding.analysis-result.metrics',
        ),
    }),
)
