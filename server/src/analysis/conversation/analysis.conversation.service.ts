import { withTransaction, type DatabaseExecutor } from '../../db/database'
import {
    createVideoEvidenceSnapshot,
    loadReadyVideoEvidenceForReference,
} from '../../video/video.analysis-evidence'
import type { ReadyVideoAnalysisEvidence } from '../../video/video.repository'
import {
    createEffectiveInputFingerprintFromDigests,
    createSemanticDraftFingerprint,
} from '../analysis.input-fingerprint'
import { createStandardAnalysisTask } from '../analysis.resolver'
import type { AnalysisDraft } from '../analysis.schema'
import { loadReadyImageDigestsForReferences } from '../media/analysis.media-delivery'
import { requiredAnalysisImageReferences } from '../media/analysis.media-input'
import { agentPromptCatalog } from '../providers/analysis.prompt.constants'
import {
    AgentContractError,
    AgentProviderError,
    readAgentConversationTurn,
    type AgentDraftPreparation,
    type AgentProvider,
} from '../providers/analysis.provider'
import { resolveAnalysisOutputLanguage } from '../providers/analysis.provider-dto'
import { createDraftPreparationArtifact } from '../tasks/analysis.preparation-artifact'
import type { AgentUsageProviderDescriptor } from '../usage/analysis.agent-usage.service'
import { compactConversationHistory } from './analysis.conversation-history'
import {
    applyConversationDraftPatch,
    groundConversationDraftPatch,
} from './analysis.conversation-patch'
import { invalidateAnalysisConversationTurnRuns } from './analysis.conversation-turn-run.repository'
import { analysisConversationTurnRunService } from './analysis.conversation-turn-run.service'
import {
    analysisConversationTurnRequestSchema,
    type AgentConversationTurn,
    type AnalysisConversationDraft,
    type AnalysisConversationSessionIdentity,
    type AnalysisConversationTurnRequest,
    type AnalysisConversationTurnResult,
} from './analysis.conversation.contract'
import {
    AnalysisConversationBusyError,
    AnalysisConversationStaleError,
    clearAnalysisConversationControl,
    getAnalysisConversationControl,
} from './analysis.conversation.repository'
import {
    AnalysisConversationBudgetExhaustedError,
    AnalysisConversationCapabilityError,
    analysisTokenManagementService,
    type AnalysisTokenManagementService,
} from './analysis.token-management.service'

interface AnalysisConversationServiceDependencies {
    provider?: () => Promise<{ provider: AgentProvider; descriptor: AgentUsageProviderDescriptor }>
    tokenManagement?: AnalysisTokenManagementService
    loadImageDigests?: (userId: string, references: string[]) => Promise<string[]>
    loadVideoEvidence?: (userId: string, videoId: string) => Promise<ReadyVideoAnalysisEvidence>
}

export {
    AnalysisConversationBudgetExhaustedError,
    AnalysisConversationBusyError,
    AnalysisConversationCapabilityError,
    AnalysisConversationStaleError,
}

const initialConversationAttempt = 1
const repairConversationAttempt = 2
type ConversationAttempt = typeof initialConversationAttempt | typeof repairConversationAttempt
type MergedAgentConversationTurn = AgentConversationTurn & {
    readonly completeDraft: AnalysisConversationDraft
}

async function runtimeProvider() {
    const { getRuntimeAgentProvider, getRuntimeAgentProviderDescriptor } =
        await import('../providers/analysis.provider-runtime')
    return {
        provider: getRuntimeAgentProvider(),
        descriptor: getRuntimeAgentProviderDescriptor('form_conversation_turn'),
    }
}

/** 草稿素材身份必须与当前元数据一致，视频封面也参与核对。 */
function assertConversationInputIntegrity(input: AnalysisConversationTurnRequest): void {
    const references = requiredAnalysisImageReferences(input.draft)
    const supplied = input.media.images.map((image) => image.reference)
    if (
        references.length !== supplied.length ||
        references.some((reference, index) => reference !== supplied[index]) ||
        (input.media.video?.reference ?? undefined) !== input.draft.videoReference
    ) {
        throw new AgentContractError('任务形成素材元数据与草稿不一致', {
            validationFieldPaths: ['media', 'draft'],
            ruleId: 'form-conversation-turn.media-integrity',
        })
    }
    // 内容形态是用户选择；素材可选，仅已有视频与非视频选择存在冲突。
    if (
        input.contentKind === 'text' ||
        (input.draft.videoReference && input.contentKind !== 'video')
    ) {
        throw new AgentContractError('任务形成内容形态与草稿不一致', {
            validationFieldPaths: ['contentKind'],
            ruleId: 'form-conversation-turn.content-kind',
        })
    }
    if (
        input.completeDraft.fields.track.value !== (input.draft.fields.track ?? null) ||
        input.completeDraft.fields.customTrackName.value !==
            (input.draft.fields.customTrackName ?? null)
    ) {
        throw new AgentContractError('完整草稿与当前用户赛道不一致', {
            validationFieldPaths: ['completeDraft.fields.track'],
            ruleId: 'form-conversation-turn.locked-track-input',
        })
    }
}

const missingFieldLabels = {
    'zh-CN': {
        title: '标题',
        body: '正文',
        topics: '话题',
    },
    'en-US': {
        title: 'title',
        body: 'body',
        topics: 'topics',
    },
} as const

function missingDraftQuestions(
    input: AnalysisConversationTurnRequest,
    draft: AnalysisConversationDraft,
): AgentConversationTurn['questions'] {
    const language = resolveAnalysisOutputLanguage([
        input.message,
        draft.fields.title.value,
        draft.fields.body.value,
    ])
    const missing = [
        !draft.fields.title.value?.trim() && 'title',
        draft.fields.topics.value.length === 0 && 'topics',
    ].filter((value): value is keyof (typeof missingFieldLabels)['zh-CN'] => Boolean(value))
    return missing.map((name) => ({
        id: `missing-${name}`,
        field: name,
        text:
            language === 'en-US'
                ? `Please provide the existing ${missingFieldLabels[language][name]} before the checkup.`
                : `请提供已有笔记的${missingFieldLabels[language][name]}后再进行体检。`,
        suggestedValue: null,
    }))
}

/** 共享草稿必填缺项优先追问，模型动作不能覆盖实际缺项。 */
function controlConversationTurn(
    input: AnalysisConversationTurnRequest,
    result: MergedAgentConversationTurn,
): MergedAgentConversationTurn {
    const questions = missingDraftQuestions(input, result.completeDraft)
    if (questions.length > 0) return { ...result, action: 'ask_questions', questions }
    if (result.action !== 'draft_ready' && result.action !== 'ask_questions') return result
    return { ...result, action: 'draft_ready', questions }
}

function mergeConversationTurn(
    input: AnalysisConversationTurnRequest,
    rawResult: unknown,
): MergedAgentConversationTurn {
    const result = readAgentConversationTurn(rawResult)
    const patch = groundConversationDraftPatch(input, result.draftPatch)
    return controlConversationTurn(input, {
        ...result,
        completeDraft: applyConversationDraftPatch(input.completeDraft, patch),
    })
}

/** 预算耗尽且模型失败时保留原草稿，绝不把最后一句话拼成笔记。 */
function preservedConversationDraft(
    input: AnalysisConversationTurnRequest,
): MergedAgentConversationTurn {
    return controlConversationTurn(input, {
        action: 'draft_ready',
        assistantMessage: null,
        questions: [],
        draftPatch: {},
        completeDraft: input.completeDraft,
    })
}

function effectiveDraft(
    input: AnalysisConversationTurnRequest,
    result: MergedAgentConversationTurn,
): AnalysisDraft {
    const fields = result.completeDraft.fields
    return {
        inputMode: 'agent',
        rawText: '',
        imageReferences: [...input.draft.imageReferences],
        ...(input.draft.coverReference ? { coverReference: input.draft.coverReference } : {}),
        ...(input.draft.videoReference ? { videoReference: input.draft.videoReference } : {}),
        fields: {
            track: input.draft.fields.track,
            ...(input.draft.fields.customTrackName
                ? { customTrackName: input.draft.fields.customTrackName }
                : {}),
            ...(fields.title.value ? { title: fields.title.value } : {}),
            ...(fields.body.value ? { body: fields.body.value } : {}),
            topics: [...fields.topics.value],
        },
    }
}

interface ManagedConversationOutcome {
    value: MergedAgentConversationTurn
    session: AnalysisConversationSessionIdentity
    budget: AnalysisConversationTurnResult['tokenBudget']
    rollingUsage: AnalysisConversationTurnResult['rollingUsage']
}

/** 结算与邮箱共用相同结果；缺项草稿不会签发正式任务凭据。 */
function createConversationTurnResult(
    userId: string,
    input: AnalysisConversationTurnRequest,
    imageDigests: string[],
    videoEvidence: ReadyVideoAnalysisEvidence | null,
    managed: ManagedConversationOutcome,
): AnalysisConversationTurnResult {
    const draft = effectiveDraft(input, managed.value)
    const hasCover = Boolean(draft.coverReference || (draft.videoReference && videoEvidence))
    const isReady =
        hasCover &&
        managed.value.action === 'draft_ready' &&
        missingDraftQuestions(input, managed.value.completeDraft).length === 0
    const preparation: AgentDraftPreparation = {
        acceptance: { status: 'accepted', message: null, clarificationQuestion: null },
        inferredFields: { title: null, body: null, topics: null },
    }
    const standardTask = isReady
        ? createStandardAnalysisTask(draft, {
              agentInference: {},
              workspaceDefault: {},
              videoEvidence: videoEvidence ? createVideoEvidenceSnapshot(videoEvidence) : null,
          })
        : null
    const fingerprint = createEffectiveInputFingerprintFromDigests(
        draft,
        imageDigests,
        videoEvidence?.originalSha256,
    )
    return {
        schemaVersion: 'analysis-conversation-turn-result.v1',
        action:
            managed.value.action === 'draft_ready' && !hasCover
                ? 'defer_media_analysis'
                : managed.value.action,
        assistantMessage: null,
        questions: managed.value.questions,
        completeDraft: managed.value.completeDraft,
        effectiveDraft: draft,
        standardTask,
        preparationId: isReady
            ? createDraftPreparationArtifact(userId, fingerprint, preparation, {
                  mediaIndependent: true,
                  semanticFingerprint: createSemanticDraftFingerprint(draft),
              })
            : null,
        session: managed.session,
        tokenBudget: managed.budget,
        rollingUsage: managed.rollingUsage,
    }
}

/** 围绕用户已有笔记的连续录入，复用账号、租约与用量结算。 */
export function createAnalysisConversationService(
    dependencies: AnalysisConversationServiceDependencies = {},
) {
    const getProvider = dependencies.provider ?? runtimeProvider
    const tokenManagement = dependencies.tokenManagement ?? analysisTokenManagementService
    const loadImageDigests = dependencies.loadImageDigests ?? loadReadyImageDigestsForReferences
    const loadVideoEvidence = dependencies.loadVideoEvidence ?? loadReadyVideoEvidenceForReference
    return {
        async formTurn(
            userId: string,
            rawInput: AnalysisConversationTurnRequest,
            signal: AbortSignal = new AbortController().signal,
            onClaimed?: () => Promise<void>,
            onSettledResult?: (
                executor: DatabaseExecutor,
                result: AnalysisConversationTurnResult,
            ) => Promise<void>,
        ) {
            const input = analysisConversationTurnRequestSchema.parse(rawInput)
            assertConversationInputIntegrity(input)
            const authorization = await tokenManagement.authorizeConversation(userId)
            const runtime = await getProvider()
            if (!runtime.provider.formConversationTurn) {
                throw new AgentProviderError('capability', {
                    message: '当前模型不支持任务形成对话',
                    retryable: false,
                })
            }
            const references = requiredAnalysisImageReferences(input.draft)
            const [imageDigests, videoEvidence] = await Promise.all([
                loadImageDigests(userId, references),
                input.draft.videoReference
                    ? loadVideoEvidence(userId, input.draft.videoReference)
                    : Promise.resolve(null),
            ])
            if (imageDigests.length !== references.length) {
                throw new AgentContractError('任务形成素材尚未准备完成', {
                    validationFieldPaths: ['media.images'],
                    ruleId: 'form-conversation-turn.media-unavailable',
                })
            }
            const providerContext = compactConversationHistory({
                history: input.history,
                message: input.message,
                completeDraft: input.completeDraft,
            })
            const createUsageCall = (attemptNumber: ConversationAttempt) => ({
                association: { kind: 'conversation' as const, id: input.session.sessionId },
                requestId: input.session.requestId,
                stage: 'form_conversation_turn' as const,
                provider: runtime.descriptor,
                promptVersion: agentPromptCatalog.formConversationTurn.version,
                attemptNumber,
                media: { imageInputCount: 0, videoFrameInputCount: 0 },
                invoke: () =>
                    runtime.provider.formConversationTurn!({
                        history: [...providerContext.history],
                        message: input.message,
                        completeDraft: input.completeDraft,
                        contentKind: input.contentKind,
                        media: {
                            imageCount: input.media.images.length,
                            videoPresent: Boolean(input.media.video),
                        },
                        signal,
                        correlation: { requestId: input.session.requestId, attempt: attemptNumber },
                    }),
                parse: (raw: unknown) => mergeConversationTurn(input, raw),
                shouldRetry: (error: unknown) =>
                    attemptNumber === initialConversationAttempt &&
                    error instanceof AgentContractError,
            })
            let settledResult: AnalysisConversationTurnResult | null = null
            const managed = await tokenManagement.executeConversationTurn({
                userId,
                authorization,
                authority: {
                    sessionId: input.session.sessionId,
                    generation: input.session.generation,
                    browserInstanceId: input.session.browserInstanceId,
                    contentKind: input.contentKind,
                    leaseId: input.session.requestId,
                },
                usageCall: createUsageCall(initialConversationAttempt),
                retryUsageCall: createUsageCall(repairConversationAttempt),
                onClaimed,
                onSettled: onSettledResult
                    ? async (executor, outcome) => {
                          settledResult = createConversationTurnResult(
                              userId,
                              input,
                              imageDigests,
                              videoEvidence,
                              outcome,
                          )
                          await onSettledResult(executor, settledResult)
                      }
                    : undefined,
                forceFinalize: (value) => value,
                fallback: () => preservedConversationDraft(input),
                estimatedTokenCount: providerContext.estimatedInputTokens,
            })
            return {
                result:
                    settledResult ??
                    createConversationTurnResult(
                        userId,
                        input,
                        imageDigests,
                        videoEvidence,
                        managed,
                    ),
            }
        },
    }
}

export const analysisConversationService = createAnalysisConversationService()

/** Read-only reconciliation never creates or takes over a conversation. */
export async function getAnalysisConversationAuthority(userId: string) {
    const control = await getAnalysisConversationControl(userId)
    if (!control) return null
    const { consumedTokens, ...identity } = control
    const [tokenBudget, rollingUsage] = await Promise.all([
        analysisTokenManagementService.getConversationBudget(userId, consumedTokens),
        analysisTokenManagementService.getRollingUsage(userId),
    ])
    return {
        ...identity,
        tokenBudget,
        rollingUsage,
    }
}

/** Close only the exact authoritative identity supplied by the browser. */
export function clearAnalysisConversationAuthority(
    userId: string,
    session: AnalysisConversationSessionIdentity,
) {
    return withTransaction(async (transaction) => {
        const cleared = await clearAnalysisConversationControl({ userId, ...session }, transaction)
        if (cleared.cleared) {
            await invalidateAnalysisConversationTurnRuns(transaction, {
                userId,
                ...session,
                reason: 'conversation_cleared',
            })
        }
        return cleared
    })
}

/** HTTP 边界使用的稳定函数，便于测试替换而不暴露内部依赖。 */
export function formAnalysisConversationTurn(
    userId: string,
    input: AnalysisConversationTurnRequest,
    signal?: AbortSignal,
    onClaimed?: () => Promise<void>,
    onSettledResult?: (
        executor: DatabaseExecutor,
        result: AnalysisConversationTurnResult,
    ) => Promise<void>,
) {
    return analysisConversationService.formTurn(userId, input, signal, onClaimed, onSettledResult)
}

/** 单一应用用例：幂等 mailbox、权威租约、Token 结算和结果落库保持同一边界。 */
export function formRecoverableAnalysisConversationTurn(
    userId: string,
    authSessionKey: string,
    rawInput: AnalysisConversationTurnRequest,
    signal?: AbortSignal,
) {
    const input = analysisConversationTurnRequestSchema.parse(rawInput)
    const { requestId, ...session } = input.session
    return analysisConversationTurnRunService.execute(
        userId,
        authSessionKey,
        requestId,
        session,
        (renewLease, settleResult) =>
            analysisConversationService.formTurn(userId, input, signal, renewLease, settleResult),
    )
}
