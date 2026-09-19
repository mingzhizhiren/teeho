import type { ComputedRef, InjectionKey, Ref } from 'vue'
import { inject } from 'vue'

import type {
    AnalysisInputMode,
    AnalysisTaskConfig,
    ResolvedTaskField,
    StandardAnalysisTask,
    TaskFieldDefinition,
    TaskFieldName,
    TaskFieldValue,
} from './analysis.contract'
import type { AnalysisConversationTokenBudget } from './analysis.conversation'
import type { AnalysisMediaRequirement } from './analysis.media-requirement'
import type {
    AnalysisContentKind,
    SharedTaskDraft,
    SharedTaskImage,
    SharedTaskVideo,
} from './taskDraft'

/** Agent 伪对话中供界面渲染的消息。 */
export interface AgentChatMessage {
    id: number
    role: 'agent' | 'user'
    text: string
    typing: boolean
    thinking?: boolean
    kind?: 'greeting' | 'technical_failure'
}

/** 分析编辑器内部视图共享的状态与操作。 */
export interface AnalysisComposerContext {
    mode: ComputedRef<AnalysisInputMode>
    agentInteractionMode: ComputedRef<'conversation'>
    operationsLocked: ComputedRef<boolean>
    conversationSyncMessage: ComputedRef<string>
    conversationTokenBudget: ComputedRef<AnalysisConversationTokenBudget | null>
    conversationAuthorityPending: Ref<boolean>
    agentSendAvailable: ComputedRef<boolean>
    taskConfig: ComputedRef<AnalysisTaskConfig | null>
    imageUploadLimits: ComputedRef<AnalysisTaskConfig['uploads'] | null>
    videoUnavailableMessage: ComputedRef<string>
    draft: SharedTaskDraft
    mediaRequirement: ComputedRef<AnalysisMediaRequirement>
    mediaRequirementMessage: ComputedRef<string>
    draftPreview: Ref<StandardAnalysisTask | null>
    previewing: Ref<boolean>
    submitting: Ref<boolean>
    checkingStorage: Ref<boolean>
    formError: Ref<string>
    agentMessages: Ref<AgentChatMessage[]>
    agentComposerText: Ref<string>
    agentTyping: Ref<boolean>
    hasAgentReplyContext: Ref<boolean>
    agentConfirmationVisible: Ref<boolean>
    agentConfirmationCurrent: ComputedRef<boolean>
    hasTaskSessionContent: ComputedRef<boolean>
    trackLocked: Ref<boolean>
    selectedTrackId: ComputedRef<string | null>
    selectedCustomTrackName: ComputedRef<string | null>
    selectedTrackLabel: ComputedRef<string | null>
    canRequestAnalysis: ComputedRef<boolean>
    canSubmit: ComputedRef<boolean>
    submissionHint: ComputedRef<string>
    submissionActionLabel: ComputedRef<string>
    accessBlockMessage: ComputedRef<string>
    visibleConfiguredFields: ComputedRef<TaskFieldDefinition[]>
    coreConfiguredFields: ComputedRef<TaskFieldDefinition[]>
    secondaryConfiguredFields: ComputedRef<TaskFieldDefinition[]>
    resolvedField: (fieldName: TaskFieldName) => ResolvedTaskField | null
    formatFieldValue: (value: TaskFieldValue | undefined, field?: TaskFieldDefinition) => string
    invalidatePreview: () => void
    updateDraftField: (fieldName: TaskFieldName, value: TaskFieldValue | undefined) => void
    updateTrackSelection: (trackId: string | null) => void
    updateCustomTrackName: (name: string | null) => void
    updateContentKind: (contentKind: AnalysisContentKind) => Promise<void>
    updateDraftImages: (images: SharedTaskImage[]) => void
    uploadDraftImages: (images: SharedTaskImage[]) => Promise<void>
    retryDraftImage: (image: SharedTaskImage) => Promise<void>
    updateDraftCover: (localId: string) => void
    updateDraftVideo: (video: SharedTaskVideo | null) => void
    clearDraftMediaAfterUploadLimit: () => void
    updateAgentComposerText: (value: string) => void
    sendAgentTurn: () => Promise<void>
    adjustAgentDraft: () => void
    requestClearConversation: () => void
    previewDraft: () => Promise<boolean>
    submitDraft: () => Promise<void>
}

/** 分析编辑器内部上下文注入键。 */
export const analysisComposerKey: InjectionKey<AnalysisComposerContext> =
    Symbol('analysis-composer')

/** 读取分析编辑器内部上下文。 */
export function useAnalysisComposerContext() {
    const context = inject(analysisComposerKey)
    if (!context) {
        throw new Error('Analysis composer context is unavailable')
    }
    return context
}
