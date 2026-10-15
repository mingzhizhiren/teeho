import type { ComputedRef, InjectionKey, Ref } from 'vue'
import { inject } from 'vue'
import type {
    AnalysisTaskConfig,
    ResolvedTaskField,
    StandardAnalysisTask,
    TaskFieldDefinition,
    TaskFieldName,
    TaskFieldValue,
} from './analysis.contract'
import type { AnalysisMediaRequirement } from './analysis.media-requirement'
import type { NoteTemplateFields } from './analysis.note-template'
import type {
    AnalysisContentKind,
    SharedTaskDraft,
    SharedTaskImage,
    SharedTaskVideo,
} from './taskDraft'

/** 表单与素材组件共享的状态和动作。 */
export interface AnalysisComposerContext {
    recoveredInput: ComputedRef<string>
    operationsLocked: ComputedRef<boolean>
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
    editNotice: Ref<string>
    canRequestAnalysis: ComputedRef<boolean>
    canSubmit: ComputedRef<boolean>
    submissionHint: ComputedRef<string>
    coreConfiguredFields: ComputedRef<TaskFieldDefinition[]>
    resolvedField: (fieldName: TaskFieldName) => ResolvedTaskField | null
    updateDraftField: (fieldName: TaskFieldName, value: TaskFieldValue | undefined) => void
    replaceNoteFields: (fields: NoteTemplateFields) => Promise<boolean>
    updateContentKind: (contentKind: AnalysisContentKind) => Promise<void>
    updateDraftImages: (images: SharedTaskImage[]) => void
    uploadDraftImages: (images: SharedTaskImage[]) => Promise<void>
    retryDraftImage: (image: SharedTaskImage) => Promise<void>
    updateDraftCover: (localId: string) => void
    updateDraftVideo: (video: SharedTaskVideo | null) => void
    clearDraftMediaAfterUploadLimit: () => void
    previewDraft: () => Promise<boolean>
    submitDraft: () => Promise<void>
}

/** 分析表单内部上下文注入键。 */
export const analysisComposerKey: InjectionKey<AnalysisComposerContext> =
    Symbol('analysis-composer')

/** 读取分析表单内部上下文。 */
export function useAnalysisComposerContext(): AnalysisComposerContext {
    const context = inject(analysisComposerKey)
    if (!context) throw new Error('Analysis composer context is unavailable')
    return context
}
