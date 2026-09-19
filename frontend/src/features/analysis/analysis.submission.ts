import {
    type AnalysisDraftPayload,
    type AnalysisInputAcceptance,
    type AnalysisInputMode,
    type AnalysisSubmissionRequestOptions,
    type AnalysisTask,
    type StandardAnalysisTask,
} from './analysis.contract'
import { i18n } from '@/locales'
import {
    estimateLocalHistoryBytes,
    resolveStorageSubmission,
    type StorageCapacity,
} from './storageCapacity'
import { activeDraftImages, createDraftPayload, type SharedTaskDraft } from './taskDraft'
import type { AnalysisSubmissionIntent } from './analysisSubmissionIntents'
import { createSubmissionInputFingerprint } from './effectiveInputFingerprint'

interface AnalysisDraftPreviewOutcome {
    acceptance: AnalysisInputAcceptance
    standardTask: StandardAnalysisTask | null
    preparationId: string | null
}

interface AnalysisTaskSubmissionOutcome {
    acceptance: AnalysisInputAcceptance
    task: AnalysisTask | null
}

/** 一次分析提交所需的草稿、模式、澄清与等待边界。 */
export interface AnalysisSubmissionInput {
    draft: SharedTaskDraft
    mode: AnalysisInputMode
    confirmationRevision: number
    conversationSession: AnalysisSubmissionRequestOptions['conversationSession']
    timeoutMs: number
}

/** 提交流程依赖的预览、提交、指纹、容量和标识适配器。 */
export interface AnalysisSubmissionAdapter {
    preview: (
        payload: AnalysisDraftPayload,
        timeoutMs: number,
    ) => Promise<AnalysisDraftPreviewOutcome>
    submit: (
        payload: AnalysisDraftPayload,
        options: AnalysisSubmissionRequestOptions,
    ) => Promise<AnalysisTaskSubmissionOutcome>
    recover: (submissionId: string) => Promise<AnalysisTask | null>
    fingerprint: (payload: AnalysisDraftPayload, imageHashes: string[]) => Promise<string>
    estimateCapacity: (requiredBytes: number) => Promise<StorageCapacity>
    randomUUID: () => string
}

/** 提交流程持久化和清理轻量提交意图所需的适配器。 */
export interface AnalysisSubmissionIntentAdapter {
    remember: (intent: AnalysisSubmissionIntent) => Promise<void>
    forget: (submissionId: string) => Promise<void>
}

/** 正式提交前的本地容量判断结果。 */
export type AnalysisSubmissionReadiness =
    | {
          kind: 'storage_warning'
          capacity: Extract<StorageCapacity, { status: 'insufficient' }>
      }
    | { kind: 'ready'; persistHistory: true }

/** 已提交任务与提交瞬间原始图片的组合结果。 */
export interface SubmittedAnalysisDraft extends AnalysisTaskSubmissionOutcome {
    originalImages: File[]
}

/** 管理一次工作台输入从预览、容量判断到幂等提交的完整流程。 */
export function createAnalysisSubmissionFlow(
    adapter: AnalysisSubmissionAdapter,
    intentAdapter: AnalysisSubmissionIntentAdapter,
) {
    let preparationId: string | null = null
    let pendingSubmission: { fingerprint: string; submissionId: string } | null = null
    const missingCoverAcceptance: AnalysisInputAcceptance = {
        status: 'clarification_required',
        message: i18n.global.t('skillAuth.missingCover'),
        clarificationQuestion: i18n.global.t('skillAuth.missingCover'),
    }

    /** 根据草稿和输入模式创建提交载荷 */
    function createPayload(input: AnalysisSubmissionInput) {
        return {
            ...createDraftPayload(input.draft, input.mode),
            rawText: '',
        }
    }

    return {
        /**
         * 预览当前草稿，缓存服务端返回的受理结果和标准任务。
         * @param input 当前流程所需的草稿和运行状态
         */
        async preview(input: AnalysisSubmissionInput) {
            if (input.draft.contentKind === 'image' && !createPayload(input).coverReference) {
                preparationId = null
                return {
                    acceptance: missingCoverAcceptance,
                    standardTask: null,
                    preparationId: null,
                }
            }
            const outcome = await adapter.preview(createPayload(input), input.timeoutMs)
            preparationId = outcome.preparationId
            return outcome
        },

        /** 接受真实多轮端点已经签发、且与当前有效草稿绑定的准备凭据。 */
        acceptPreparation(prepared: { preparationId: string }) {
            preparationId = prepared.preparationId
            pendingSubmission = null
        },

        /**
         * 执行提交前门禁并复用仍有效的预览结果。
         * @param input 当前流程所需的草稿和运行状态
         */
        async assess(input: AnalysisSubmissionInput): Promise<AnalysisSubmissionReadiness> {
            const payload = createPayload(input)
            const requiredBytes = estimateLocalHistoryBytes({
                draft: payload,
                images: activeDraftImages(input.draft).map((image) => image.file),
            })
            const capacity = await adapter.estimateCapacity(requiredBytes)
            const decision = resolveStorageSubmission(capacity)
            if (decision.action === 'await_choice' && capacity.status === 'insufficient') {
                return {
                    kind: 'storage_warning',
                    capacity,
                }
            }
            return {
                kind: 'ready',
                persistHistory: true,
            }
        },

        /**
         * 提交通过门禁的草稿，并在网络失败重试时复用同一个幂等标识。
         * @param input 当前流程所需的草稿和运行状态
         */
        async submit(
            input: AnalysisSubmissionInput,
            persistHistory: boolean,
        ): Promise<SubmittedAnalysisDraft> {
            const originalImages = activeDraftImages(input.draft).map((image) => image.file)
            const payload = createPayload(input)
            if (input.draft.contentKind === 'image' && !payload.coverReference) {
                preparationId = null
                pendingSubmission = null
                return { acceptance: missingCoverAcceptance, task: null, originalImages }
            }
            const preparationFingerprint = await adapter.fingerprint(
                payload,
                activeDraftImages(input.draft).map((image) => image.contentHash!),
            )
            const fingerprint = await createSubmissionInputFingerprint(preparationFingerprint)
            if (pendingSubmission?.fingerprint !== fingerprint) {
                pendingSubmission = {
                    fingerprint,
                    submissionId: adapter.randomUUID(),
                }
            }
            const intent: AnalysisSubmissionIntent = {
                submissionId: pendingSubmission.submissionId,
                inputFingerprint: fingerprint,
                persistHistory,
            }
            await intentAdapter.remember(intent)
            let outcome: AnalysisTaskSubmissionOutcome
            try {
                outcome = await adapter.submit(payload, {
                    preparationId: preparationId ?? undefined,
                    submissionId: pendingSubmission.submissionId,
                    confirmationRevision: input.confirmationRevision,
                    conversationSession: input.conversationSession,
                    timeoutMs: input.timeoutMs,
                })
            } catch (error) {
                let recoveredTask: AnalysisTask | null = null
                try {
                    recoveredTask = await adapter.recover(pendingSubmission.submissionId)
                } catch {
                    // 恢复查询失败时保留原始传输错误和本地会话，供用户安全重试。
                }
                if (!recoveredTask) throw error
                outcome = {
                    acceptance: {
                        status: 'accepted',
                        message: null,
                        clarificationQuestion: null,
                    },
                    task: recoveredTask,
                }
            }
            pendingSubmission = null
            if (outcome.task) {
                preparationId = null
                if (outcome.task.id !== intent.submissionId) {
                    await intentAdapter.remember({
                        ...intent,
                        submissionId: outcome.task.id,
                    })
                    await intentAdapter.forget(intent.submissionId)
                }
            } else {
                await intentAdapter.forget(intent.submissionId)
            }
            return {
                ...outcome,
                originalImages,
            }
        },

        /** 草稿、图片或澄清上下文变化后丢弃不可再复用的凭据。 */
        invalidate(options: { preservePreparation?: boolean } = {}) {
            if (!options.preservePreparation) preparationId = null
            pendingSubmission = null
        },
    }
}
