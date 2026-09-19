import { TIME_MS } from '../config/constants'
import { env } from '../config/env'
import {
    createVideoEvidenceSnapshot,
    loadReadyVideoEvidenceForReference,
} from '../video/video.analysis-evidence'
import type { ReadyVideoAnalysisEvidence } from '../video/video.repository'
import { analysisTaskConfig } from './analysis.config'
import { analysisExecutionConstraints } from './analysis.constants'
import { AnalysisSubmissionConflictError, AnalysisTaskStateError } from './analysis.errors'
import { createAnalysisFingerprints, createAnalysisMediaHashes } from './analysis.fingerprints'
import {
    createEffectiveInputFingerprint,
    createSemanticDraftFingerprint,
    createSubmissionInputFingerprint,
    createVideoEffectiveInputFingerprint,
} from './analysis.input-fingerprint'
import { createStandardAnalysisTask } from './analysis.resolver'
import type { AnalysisDraft, StandardAnalysisTask, VideoEvidenceReference } from './analysis.schema'
import { loadAgentImagesForReferences } from './media/analysis.media-delivery'
import { requiredAnalysisImageReferences } from './media/analysis.media-input'
import {
    type AgentDraftPreparation,
    type AgentInputAssessment,
} from './providers/analysis.provider'
import {
    createDraftPreparationArtifact,
    readDraftPreparationArtifact,
    readMediaIndependentDraftPreparationArtifact,
} from './tasks/analysis.preparation-artifact'
import {
    cancelRunningAnalysisTask,
    requestAnalysisTaskProcessing,
} from './tasks/analysis.processing'
import type { AnalysisTaskAdmission } from './tasks/analysis.task-admission'
import {
    findActiveAnalysisTask,
    findActiveAnalysisTaskByFingerprint,
    findAnalysisTaskById,
    findAnalysisTasks,
    findLatestAnalysisTask,
    type AnalysisTaskRecord,
} from './tasks/analysis.task.repository'
import {
    abandonActiveAnalysisTask,
    createReanalysisTask,
    createResearchingAnalysisTask,
    retryFailedAnalysisTask,
} from './tasks/analysis.task.service'
export {
    createEffectiveInputFingerprint,
    createEffectiveInputFingerprintFromDigests,
    createVideoEffectiveInputFingerprint,
} from './analysis.input-fingerprint'

const workspaceDefaults = {}

/** 定制模式已是结构化共享草稿，不需要第一层自然语言推断。 */
function createDirectDraftPreparation(): AgentDraftPreparation {
    return {
        acceptance: {
            status: 'accepted',
            message: null,
            clarificationQuestion: null,
        },
        inferredFields: { title: null, body: null, topics: null },
    }
}

/** 输入受理和正式任务创建的统一结果 */
export interface AnalysisSubmissionOutcome {
    acceptance: AgentInputAssessment
    task: AnalysisTaskRecord | null
}

/** 草稿准入所使用的可替换素材读取边界。 */
export interface AnalysisDraftPreparationOptions {
    signal?: AbortSignal
    loadImages?: typeof loadAgentImagesForReferences
    loadVideoEvidence?: (userId: string, videoId: string) => Promise<ReadyVideoAnalysisEvidence>
}

/** 首次提交可携带一次性预览凭据 */
export interface AnalysisSubmissionOptions extends AnalysisDraftPreparationOptions {
    admission?: AnalysisTaskAdmission
    preparationId?: string
    submissionId?: string
}

/** 把提交草稿解析为完整的标准任务 */
function resolveStandardTask(
    draft: AnalysisDraft,
    preparation: AgentDraftPreparation,
    videoEvidence: VideoEvidenceReference | null = null,
): StandardAnalysisTask {
    return createStandardAnalysisTask(draft, {
        agentInference: preparation.inferredFields,
        workspaceDefault: workspaceDefaults,
        videoEvidence,
    })
}

/** 两个入口都只检查用户已提供笔记的完整性。 */
function prepareDraft(draft: AnalysisDraft): AgentDraftPreparation {
    const missing = [
        !draft.videoReference && !draft.coverReference && '封面',
        !draft.fields.title?.trim() && '标题',
        !draft.fields.topics?.length && '话题',
    ].filter(Boolean)
    const result = createDirectDraftPreparation()
    return missing.length
        ? {
              ...result,
              acceptance: {
                  status: 'clarification_required',
                  message: `请补充${missing.join('、')}`,
                  clarificationQuestion: `请提供${missing.join('、')}后再进行体检。`,
              },
          }
        : result
}
/** 返回前端渲染定制任务所需的公开版本化配置 */
export async function getAnalysisTaskConfig() {
    const { deploymentCapabilities, isVideoEnabled } = await import('../config/deployment')
    const { getTaskPolicy } = await import('../runtime/task-policy')
    const policy = getTaskPolicy().publicConfiguration()
    return {
        ...analysisTaskConfig,
        uploads: {
            ...analysisTaskConfig.uploads,
            videoEnabled: isVideoEnabled(),
            video: { ...analysisTaskConfig.uploads.video, pointCost: policy.videoPointCost },
        },
        runtime: {
            ...deploymentCapabilities,
            pointsEnabled: policy.pointsEnabled,
            preparationRequestTimeoutMs:
                env.TEEHO_AGENT_TIMEOUT_SECONDS *
                    analysisExecutionConstraints.maxDraftPreparationAttempts *
                    TIME_MS.SECOND +
                analysisExecutionConstraints.preparationRequestMarginMs,
        },
    }
}

/** 预览完整笔记及素材准入，不调用模型或创建正式任务。 */
export async function previewAnalysisDraft(
    userId: string,
    draft: AnalysisDraft,
    options: AnalysisDraftPreparationOptions = {},
) {
    const videoEvidence = draft.videoReference
        ? await (options.loadVideoEvidence ?? loadReadyVideoEvidenceForReference)(
              userId,
              draft.videoReference,
          )
        : null
    const images = await (options.loadImages ?? loadAgentImagesForReferences)(
        userId,
        requiredAnalysisImageReferences(draft),
    )
    const preparation = prepareDraft(draft)
    if (preparation.acceptance.status !== 'accepted') {
        return {
            acceptance: preparation.acceptance,
            standardTask: null,
            preparationId: null,
        }
    }

    const fingerprint = createEffectiveInputFingerprint(
        draft,
        images,
        videoEvidence?.originalSha256,
    )
    const preview = {
        acceptance: preparation.acceptance,
        standardTask: resolveStandardTask(
            draft,
            preparation,
            videoEvidence ? createVideoEvidenceSnapshot(videoEvidence) : null,
        ),
        preparationId: createDraftPreparationArtifact(userId, fingerprint, preparation),
    }
    return preview
}

/** 门禁受理后立即创建后台排队任务，HTTP 请求内不执行正式分析 */
export async function submitAnalysisTask(
    userId: string,
    draft: AnalysisDraft,
    options: AnalysisSubmissionOptions = {},
): Promise<AnalysisSubmissionOutcome> {
    const videoEvidence = draft.videoReference
        ? await (options.loadVideoEvidence ?? loadReadyVideoEvidenceForReference)(
              userId,
              draft.videoReference,
          )
        : null
    const images = await (options.loadImages ?? loadAgentImagesForReferences)(
        userId,
        requiredAnalysisImageReferences(draft),
    )
    const preparationFingerprint = createEffectiveInputFingerprint(
        draft,
        images,
        videoEvidence?.originalSha256,
    )
    const submissionFingerprint = createSubmissionInputFingerprint(preparationFingerprint)
    const reusedArtifact = options.preparationId
        ? readDraftPreparationArtifact(options.preparationId, userId, preparationFingerprint)
        : null
    const mediaRefreshedArtifact =
        !reusedArtifact && options.preparationId
            ? readMediaIndependentDraftPreparationArtifact(
                  options.preparationId,
                  userId,
                  createSemanticDraftFingerprint(draft),
              )
            : null
    const preparationArtifact = reusedArtifact ?? mediaRefreshedArtifact
    const submissionId =
        options.admission?.idempotencyKey ??
        preparationArtifact?.submissionId ??
        options.submissionId ??
        crypto.randomUUID()
    const existingTask = await findAnalysisTaskById(userId, submissionId)
    if (existingTask && !videoEvidence) {
        if (existingTask.inputFingerprint !== submissionFingerprint) {
            throw new AnalysisSubmissionConflictError()
        }
        return {
            acceptance: {
                status: 'accepted',
                message: null,
                clarificationQuestion: null,
            },
            task: existingTask,
        }
    }
    const activeTask = videoEvidence
        ? null
        : await findActiveAnalysisTaskByFingerprint(userId, submissionFingerprint)
    if (activeTask) {
        return {
            acceptance: {
                status: 'accepted',
                message: null,
                clarificationQuestion: null,
            },
            task: activeTask,
        }
    }
    const preparation = preparationArtifact ? preparationArtifact.preparation : prepareDraft(draft)
    const { acceptance } = preparation

    if (acceptance.status !== 'accepted') {
        return { acceptance, task: null }
    }

    const standardTask = resolveStandardTask(
        draft,
        preparation,
        videoEvidence ? createVideoEvidenceSnapshot(videoEvidence) : null,
    )
    const fingerprint = videoEvidence
        ? createSubmissionInputFingerprint(createVideoEffectiveInputFingerprint(standardTask))
        : submissionFingerprint
    const fingerprints = createAnalysisFingerprints(
        standardTask,
        createAnalysisMediaHashes(images, videoEvidence?.originalSha256),
    )
    if (videoEvidence) {
        const repeatedSubmission = await findAnalysisTaskById(userId, submissionId)
        if (repeatedSubmission) {
            if (repeatedSubmission.inputFingerprint !== fingerprint) {
                throw new AnalysisSubmissionConflictError()
            }
            return { acceptance, task: repeatedSubmission }
        }
        const repeatedActive = await findActiveAnalysisTaskByFingerprint(userId, fingerprint)
        if (repeatedActive) {
            return { acceptance, task: repeatedActive }
        }
    }
    const taskId = await createResearchingAnalysisTask({
        taskId: submissionId,
        userId,
        inputMode: draft.inputMode,
        inputFingerprint: fingerprint,
        fingerprints,
        standardTask,
        assetIds: requiredAnalysisImageReferences(draft),
        session: options.admission?.session,
    })
    const task = await findAnalysisTaskById(userId, taskId)
    if (!task) {
        throw new Error('分析任务保存后无法读取')
    }

    if (taskId === submissionId) requestAnalysisTaskProcessing()
    return { acceptance, task }
}

/** 读取当前用户指定的原任务与原结果 */
export function getAnalysisTask(userId: string, taskId: string) {
    return findAnalysisTaskById(userId, taskId)
}

/** 提交响应未知时优先读取同一幂等任务，否则读取账号已经成立的唯一活动任务。 */
export async function getAnalysisTaskAdmission(userId: string, submissionId: string) {
    return (
        (await findAnalysisTaskById(userId, submissionId)) ?? (await findActiveAnalysisTask(userId))
    )
}

/** 读取当前用户最近的原任务与原结果 */
export function getLatestAnalysisTask(userId: string) {
    return findLatestAnalysisTask(userId)
}

/** 读取工作台最近任务和后台状态 */
export function getAnalysisTasks(userId: string) {
    return findAnalysisTasks(userId)
}

/** 读取重新入队后应返回给调用方的任务 */
async function readRequeuedAnalysisTask(userId: string, taskId: string, missingMessage: string) {
    const task = await findAnalysisTaskById(userId, taskId)
    if (!task) {
        throw new Error(missingMessage)
    }
    requestAnalysisTaskProcessing()
    return task
}

/** 用户放弃仍处于资料搜集、排队、执行或重试中的任务。 */
export async function abandonAnalysisTask(userId: string, taskId: string) {
    const abandoned = await abandonActiveAnalysisTask(taskId, userId)
    if (abandoned) {
        cancelRunningAnalysisTask(taskId)
    }
    const task = await findAnalysisTaskById(userId, taskId)
    if (!task) {
        throw new Error('放弃后无法读取分析任务')
    }
    if (!abandoned && task.status !== 'abandoned' && task.status !== 'succeeded') {
        throw new AnalysisTaskStateError('只有资料搜集、等待或分析中的任务可以放弃')
    }
    requestAnalysisTaskProcessing()
    return task
}

/** 第二次失败后人工重试同一任务，不创建新的计费任务 */
export async function retryAnalysisTask(userId: string, taskId: string) {
    const retried = await retryFailedAnalysisTask(taskId, userId)
    if (!retried) {
        throw new AnalysisTaskStateError('只有自动重试后仍失败的任务可以人工重试')
    }
    return readRequeuedAnalysisTask(userId, taskId, '重试后无法读取分析任务')
}

/** 使用客户端稳定提交身份创建或恢复再次体检任务。 */
export async function reanalyzeAnalysisTask(
    userId: string,
    sourceTaskId: string,
    submissionId: string,
): Promise<AnalysisTaskRecord> {
    const createdTaskId = await createReanalysisTask(sourceTaskId, submissionId, userId)
    if (!createdTaskId) {
        throw new AnalysisTaskStateError('只有成功任务可以重新分析')
    }
    return readRequeuedAnalysisTask(userId, createdTaskId, '重新分析创建后无法读取任务')
}
