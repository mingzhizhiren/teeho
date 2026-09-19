import { createHash } from 'node:crypto'

import { z } from 'zod'

import { VIDEO_RULES } from '../../config/constants'
import {
    analysisInputConstraints,
    analysisProviderDebugConstraints,
    analysisProviderImageConstraints,
} from '../analysis.constants'
import { type StandardAnalysisTask } from '../analysis.schema'
import {
    checkupAgentResultSchema,
    checkupEvaluationsSchema,
} from '../checkup/analysis.checkup.contract'
import type { CheckupTopicEvidence } from '../checkup/analysis.checkup.topics'
import { findGeneratedResultQualityViolations } from '../checkup/analysis.result-quality'
import {
    agentConversationTurnSchema,
    agentConversationTurnWireSchema,
    type AgentConversationTurn,
    type AnalysisConversationDraft,
    type AnalysisConversationMessage,
} from '../conversation/analysis.conversation.contract'
import type { AnalysisWebResearchSnapshot } from '../research/analysis.web-research'
import type { AgentRequestDiagnostics } from '../usage/analysis.agent-usage.contract'
import { normalizeAgentGeneratedOutput } from './analysis.agent-output-normalization'

/** 单次 Provider 调用内可用的处理后私有图片；厂商编码只发生在 adapter 内。 */
export interface AgentImageAsset {
    reference: string
    /** 本附件代表的原稿资源；完全重复去重后保留，用于原稿索引定位，不进入模型 DTO。 */
    originalReferences?: readonly string[]
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
    byteSize: number
    width: number
    height: number
    content: Uint8Array
    /** 原文件内容 SHA-256；仅用于 Provider 输入完全重复去重，不进入模型 DTO。 */
    sourceSha256?: string
    availability: 'processed_private'
}

export type AgentImageProviderKind = 'codex' | 'openai' | 'gemini'

/** 在厂商编码前验证派生图可访问性、格式、尺寸和单次请求容量。 */
export function validateAgentImagesForProvider(
    images: AgentImageAsset[],
    provider: AgentImageProviderKind,
    purpose: 'task_images' | 'video_frames' = 'task_images',
) {
    const maximumFiles =
        purpose === 'video_frames'
            ? VIDEO_RULES.maximumFrames
            : analysisProviderImageConstraints.maxFiles
    const maximumEdgePixels =
        purpose === 'video_frames'
            ? VIDEO_RULES.frameMaximumEdgePixels
            : analysisProviderImageConstraints.maxEdgePixels
    const invalidImage = images.find(
        (image) =>
            image.availability !== 'processed_private' ||
            !['image/jpeg', 'image/png', 'image/webp'].includes(image.mediaType) ||
            image.byteSize <= 0 ||
            image.content.byteLength !== image.byteSize ||
            image.byteSize > analysisProviderImageConstraints.maxSingleBytes ||
            image.width <= 0 ||
            image.height <= 0 ||
            Math.max(image.width, image.height) > maximumEdgePixels,
    )
    const totalBytes = images.reduce((total, image) => total + image.byteSize, 0)
    if (
        invalidImage ||
        images.length > maximumFiles ||
        totalBytes > analysisProviderImageConstraints.maxTotalBytes[provider]
    ) {
        throw new AgentProviderError('capability', {
            message: '处理后的图片超出当前模型请求边界',
            retryable: false,
            validationFieldPaths: ['images'],
            ruleId: `provider.${provider}.image-limits`,
        })
    }
}

/** Provider 可见的视频关键帧时序与媒体元数据；不含任何存储身份。 */
export const agentVideoEvidenceSchema = z
    .object({
        schemaVersion: z.literal('agent-video-evidence.v1'),
        durationMs: z.number().int().positive().max(VIDEO_RULES.maximumDurationMs),
        width: z.number().int().positive().max(VIDEO_RULES.maximumEdgePixels),
        height: z.number().int().positive().max(VIDEO_RULES.maximumEdgePixels),
        container: z.string().trim().min(1).max(VIDEO_RULES.metadataLabelMaxLength),
        videoCodec: z.string().trim().min(1).max(VIDEO_RULES.metadataLabelMaxLength),
        hasAudio: z.boolean(),
        frames: z
            .array(
                z
                    .object({
                        reference: z.string().regex(/^video-frame-[1-9][0-9]*$/u),
                        timestampMs: z.number().int().nonnegative(),
                        selectionReason: z
                            .string()
                            .trim()
                            .min(1)
                            .max(VIDEO_RULES.frameSelectionReasonMaxLength),
                        width: z.number().int().positive().max(VIDEO_RULES.frameMaximumEdgePixels),
                        height: z.number().int().positive().max(VIDEO_RULES.frameMaximumEdgePixels),
                    })
                    .strict(),
            )
            .min(1)
            .max(VIDEO_RULES.maximumFrames),
    })
    .strict()

/** 提供给分析智能体的视频证据。 */
export type AgentVideoEvidence = z.infer<typeof agentVideoEvidenceSchema>

/** 验证视频时序元数据与实际附件一一对应。 */
export function validateAgentVideoEvidenceForProvider(
    videoEvidence: AgentVideoEvidence | null | undefined,
    images: AgentImageAsset[],
    provider: AgentImageProviderKind,
) {
    if (!videoEvidence) {
        validateAgentImagesForProvider(images, provider)
        return
    }
    const parsed = agentVideoEvidenceSchema.parse(videoEvidence)
    const frameReferences = new Set(parsed.frames.map((frame) => frame.reference))
    const frames = images.filter((image) => frameReferences.has(image.reference))
    const covers = images.filter((image) => !frameReferences.has(image.reference))
    validateAgentImagesForProvider(frames, provider, 'video_frames')
    validateAgentImagesForProvider(covers, provider, 'task_images')
    if (
        covers.length > 1 ||
        images.reduce((total, image) => total + image.byteSize, 0) >
            analysisProviderImageConstraints.maxTotalBytes[provider] ||
        parsed.frames.length !== frames.length ||
        parsed.frames.some((frame, index) => {
            const image = frames[index]
            return (
                !image ||
                image.reference !== frame.reference ||
                image.width !== frame.width ||
                image.height !== frame.height ||
                image.mediaType !== 'image/webp'
            )
        })
    ) {
        throw new AgentProviderError('capability', {
            message: '视频关键帧元数据与附件不一致',
            retryable: false,
            validationFieldPaths: ['videoEvidence.frames', 'images'],
            ruleId: `provider.${provider}.video-frame-integrity`,
        })
    }
}

const acceptedInputAssessmentSchema = z
    .object({
        status: z.literal('accepted'),
        message: z.null(),
        clarificationQuestion: z.null(),
    })
    .strict()

const clarificationInputAssessmentSchema = z
    .object({
        status: z.literal('clarification_required'),
        message: z.string().trim().min(1).max(analysisInputConstraints.providerMessageMaxLength),
        clarificationQuestion: z
            .string()
            .trim()
            .min(1)
            .max(analysisInputConstraints.clarification.questionMaxLength),
    })
    .strict()

const rejectedInputAssessmentSchema = z
    .object({
        status: z.enum(['invalid', 'out_of_scope']),
        message: z.string().trim().min(1).max(analysisInputConstraints.providerMessageMaxLength),
        clarificationQuestion: z.null(),
    })
    .strict()

/** Provider 对输入是否可执行的稳定结构化契约 */
export const agentInputAssessmentSchema = z.discriminatedUnion('status', [
    acceptedInputAssessmentSchema,
    clarificationInputAssessmentSchema,
    rejectedInputAssessmentSchema,
])

/** Provider 输入受理结果 */
export type AgentInputAssessment = z.infer<typeof agentInputAssessmentSchema>

/** 把未知值规范化为可空文本 */
const nullableText = (maxLength: number) => z.string().min(1).max(maxLength).nullable()

/** Provider 可推断的标准任务字段 */
export const agentDraftInferenceFieldsSchema = z
    .object({
        title: nullableText(analysisInputConstraints.fields.titleMaxLength),
        body: nullableText(analysisInputConstraints.fields.bodyMaxLength),
        topics: z
            .array(z.string().min(1).max(analysisInputConstraints.fields.topicItemMaxLength))
            .max(analysisInputConstraints.fields.topicsMaxItems)
            .nullable(),
    })
    .strict()

/** 本地草稿校验与已签名准备凭据共用的严格契约。 */
export const agentDraftPreparationSchema = z
    .object({
        acceptance: agentInputAssessmentSchema,
        inferredFields: agentDraftInferenceFieldsSchema,
    })
    .strict()

/** 草稿准备结果，不再对应模型调用阶段。 */
export type AgentDraftPreparation = z.infer<typeof agentDraftPreparationSchema>

/** Provider 调用所需的最小关联信息 */
export interface AgentProviderCorrelation {
    requestId: string
    taskId?: string
    attempt?: number
}

/** Provider 可选返回的内部用量；不参与业务结果，也不进入公开 API。 */
export interface AgentProviderUsage {
    inputTokens: number | null
    textInputTokens: number | null
    imageInputTokens: number | null
    cachedInputTokens: number | null
    reasoningTokens: number | null
    outputTokens: number | null
    totalTokens: number | null
}

/** 仅在 DEBUG 日志中输出的脱敏 Provider 诊断信息。 */
export type AgentProviderDebugDetails = Record<string, unknown>

const sensitiveDebugKey = /api.?key|authorization|cookie|credential|header|password|secret|token/iu

/** 清理调试文本中的敏感信息并限制长度 */
function redactDebugString(value: string) {
    const truncated =
        value.length > analysisProviderDebugConstraints.stringMaxLength
            ? `${value.slice(0, analysisProviderDebugConstraints.stringMaxLength)}…[truncated]`
            : value
    return truncated
        .replace(
            /((?:["']?authorization["']?)\s*[:=]\s*["']?bearer\s+)[^\s,;"']+/giu,
            '$1[REDACTED]',
        )
        .replace(
            /((?:["']?(?:api.?key|cookie|credential|password|secret|token)["']?)\s*[:=]\s*["']?)[^\s,;"']+/giu,
            '$1[REDACTED]',
        )
        .replace(/\b(?:sk-|AIza)[A-Za-z0-9_-]{6,}\b/gu, '[REDACTED]')
}

/** 递归筛选并脱敏允许记录的调试值 */
function sanitizeDebugValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
    if (value === null || typeof value === 'boolean' || typeof value === 'number') {
        return value
    }
    if (typeof value === 'string') {
        return redactDebugString(value)
    }
    if (typeof value !== 'object') {
        return String(value)
    }
    if (depth >= analysisProviderDebugConstraints.valueMaxDepth) {
        return '[maximum depth]'
    }
    if (seen.has(value)) {
        return '[circular]'
    }
    seen.add(value)

    if (Array.isArray(value)) {
        const items = value
            .slice(0, analysisProviderDebugConstraints.arrayMaxLength)
            .map((item) => sanitizeDebugValue(item, depth + 1, seen))
        if (value.length > analysisProviderDebugConstraints.arrayMaxLength) {
            items.push(
                `[${value.length - analysisProviderDebugConstraints.arrayMaxLength} more items]`,
            )
        }
        return items
    }

    const result: Record<string, unknown> = {}
    const entries = Object.entries(value).slice(0, analysisProviderDebugConstraints.objectMaxKeys)
    for (const [key, item] of entries) {
        result[key] = sensitiveDebugKey.test(key)
            ? '[REDACTED]'
            : sanitizeDebugValue(item, depth + 1, seen)
    }
    if (Object.keys(value).length > analysisProviderDebugConstraints.objectMaxKeys) {
        result.truncatedKeys =
            Object.keys(value).length - analysisProviderDebugConstraints.objectMaxKeys
    }
    return result
}

/** 限长并脱敏第三方错误或模型输出，避免 DEBUG 日志泄露凭据。 */
export function sanitizeAgentProviderDebugDetails(
    value: AgentProviderDebugDetails,
): AgentProviderDebugDetails {
    return sanitizeDebugValue(value, 0, new WeakSet()) as AgentProviderDebugDetails
}

/** 传输层可获得的内部执行元数据。 */
export interface AgentProviderExecutionMetadata {
    executionId: string | null
    usage: AgentProviderUsage | null
    inputDiagnostics?: AgentRequestDiagnostics | null
}

const executionMetadataByResult = new WeakMap<object, AgentProviderExecutionMetadata>()
const rawTextByUnparseableOutput = new WeakMap<object, string>()

/** 保留结构化传输返回的原始非 JSON 文本，使业务层仍可执行唯一一次完整修复。 */
export function createAgentUnparseableOutput(rawText: string): object {
    const output = Object.freeze({})
    rawTextByUnparseableOutput.set(output, rawText)
    return output
}

/** 读取不透明原始输出；普通 Provider 返回值不会命中。 */
export function readAgentUnparseableOutput(value: unknown): string | null {
    return typeof value === 'object' && value !== null
        ? (rawTextByUnparseableOutput.get(value) ?? null)
        : null
}

/** 将传输元数据附着到一次 Provider 返回值，不污染共享业务 Schema。 */
export function attachAgentProviderExecutionMetadata(
    value: unknown,
    metadata: AgentProviderExecutionMetadata,
) {
    if (typeof value === 'object' && value !== null) {
        executionMetadataByResult.set(value, metadata)
    }
    return value
}

function agentOutputDebugSummary(value: unknown) {
    const rawText = readAgentUnparseableOutput(value)
    let serialized: string
    try {
        serialized = rawText ?? JSON.stringify(value) ?? String(value)
    } catch {
        serialized = `[unserializable:${typeof value}]`
    }
    return {
        outputKind:
            rawText !== null
                ? 'unparseable_text'
                : value === null
                  ? 'null'
                  : Array.isArray(value)
                    ? 'array'
                    : typeof value,
        outputCharacterCount: Array.from(serialized).length,
        outputSha256: createHash('sha256').update(serialized).digest('hex'),
        topLevelKeyCount:
            typeof value === 'object' && value !== null && !Array.isArray(value)
                ? Object.keys(value).length
                : 0,
    }
}

/** 读取 Provider 返回值携带的内部执行元数据。 */
export function readAgentProviderExecutionMetadata(
    value: unknown,
): AgentProviderExecutionMetadata | null {
    return typeof value === 'object' && value !== null
        ? (executionMetadataByResult.get(value) ?? null)
        : null
}

/** Codex 任务形成输入；媒体只暴露数量，不传文件、文件名或可推断内容的引用。 */
export interface AgentConversationTurnInput {
    history: AnalysisConversationMessage[]
    message: string
    completeDraft: AnalysisConversationDraft
    contentKind: 'text' | 'image' | 'video'
    media: {
        imageCount: number
        videoPresent: boolean
    }
    signal: AbortSignal
    correlation: AgentProviderCorrelation
}

/** Provider 错误分类；只用于重试决策和脱敏日志。 */
export type AgentProviderErrorCategory =
    | 'timeout'
    | 'rate_limited'
    | 'temporary_unavailable'
    | 'authentication'
    | 'cli_missing'
    | 'configuration'
    | 'capability'
    | 'budget_exhausted'
    | 'invalid_output'
    | 'cancelled'
    | 'unknown'

const agentProviderDiagnosticMessages: Record<AgentProviderErrorCategory, string> = {
    timeout: 'Agent Provider 调用超时',
    rate_limited: 'Agent Provider 请求受到限流',
    temporary_unavailable: 'Agent Provider 暂时不可用',
    authentication: 'Agent Provider 身份验证失败',
    cli_missing: 'Codex CLI 不可用',
    configuration: 'Agent Provider 配置错误',
    capability: 'Agent Provider 不支持当前任务能力',
    budget_exhausted: 'Agent Provider 调用已达到预算上限',
    invalid_output: 'Agent 输出结构无效',
    cancelled: 'Agent Provider 调用已取消',
    unknown: 'Agent Provider 未分类异常',
}

/** 所有 Provider 使用的统一错误。 */
export class AgentProviderError extends Error {
    /**
     * 创建带分类、重试策略和脱敏诊断信息的 Provider 错误。
     * @param category 稳定的 Provider 失败类别
     * @param options 错误消息、重试属性、校验路径、规则及诊断上下文
     */
    constructor(
        readonly category: AgentProviderErrorCategory,
        options: {
            message?: string
            retryable?: boolean
            validationFieldPaths?: string[]
            ruleId?: string
            diagnosticMessage?: string
            cause?: unknown
            debugDetails?: AgentProviderDebugDetails
        } = {},
    ) {
        super(options.message ?? 'Agent Provider 调用失败', { cause: options.cause })
        this.name = 'AgentProviderError'
        this.retryable =
            options.retryable ??
            ['timeout', 'rate_limited', 'temporary_unavailable', 'invalid_output'].includes(
                category,
            )
        this.validationFieldPaths = options.validationFieldPaths ?? []
        this.ruleId = options.ruleId ?? null
        this.diagnosticMessage =
            options.diagnosticMessage ?? agentProviderDiagnosticMessages[category]
        this.debugDetails = options.debugDetails
            ? sanitizeAgentProviderDebugDetails(options.debugDetails)
            : null
    }

    readonly retryable: boolean
    readonly validationFieldPaths: string[]
    readonly ruleId: string | null
    readonly diagnosticMessage: string
    readonly debugDetails: AgentProviderDebugDetails | null
}

/** Provider 调用超时。 */
export class AgentTimeoutError extends AgentProviderError {
    /**
     * 创建可重试的 Provider 超时错误。
     * @param message 超时错误描述
     * @param cause 触发超时的原始原因
     */
    constructor(message = 'Agent 调用超时', cause?: unknown) {
        super('timeout', { message, retryable: true, cause })
        this.name = 'AgentTimeoutError'
    }
}

/** Provider 返回值不符合稳定契约。 */
export class AgentContractError extends AgentProviderError {
    /**
     * 创建 Provider 输出不符合稳定契约的错误。
     * @param message 契约校验失败的描述
     * @param options 校验字段、规则、原始原因及脱敏诊断信息
     */
    constructor(
        message = 'Agent 返回结构无效',
        options: {
            validationFieldPaths?: string[]
            ruleId?: string
            cause?: unknown
            debugDetails?: AgentProviderDebugDetails
        } = {},
    ) {
        super('invalid_output', {
            message,
            retryable: true,
            validationFieldPaths: options.validationFieldPaths,
            ruleId: options.ruleId,
            cause: options.cause,
            debugDetails: options.debugDetails,
        })
        this.name = 'AgentContractError'
    }
}

/** 生成只含稳定安全消息的日志字段；DEBUG 时才附带脱敏诊断详情。 */
export function agentProviderErrorLogFields(error: unknown, includeDebugDetails: boolean) {
    if (!(error instanceof AgentProviderError)) {
        return {
            errorCategory: 'unknown',
            diagnosticMessage: '未知 Provider 异常',
            validationFieldPaths: [] as string[],
            ruleId: null,
        }
    }
    const fields = {
        errorCategory: error.category,
        diagnosticMessage: error.diagnosticMessage,
        validationFieldPaths: error.validationFieldPaths,
        ruleId: error.ruleId,
    }
    return includeDebugDetails && error.debugDetails
        ? { ...fields, providerDebug: error.debugDetails }
        : fields
}

/** 用户取消或服务停止后中止 Provider。 */
export class AgentCancelledError extends AgentProviderError {
    /**
     * 创建不可重试的 Provider 调用取消错误。
     * @param message 取消原因描述
     * @param cause 触发取消的原始原因
     */
    constructor(message = 'Agent 调用已取消', cause?: unknown) {
        super('cancelled', { message, retryable: false, cause })
        this.name = 'AgentCancelledError'
    }
}

/** 最终 Agent 独立的百分制六维评审契约。 */
export const agentMetricEvaluationsSchema = checkupEvaluationsSchema

/** 模型供应商与业务层共用体检输出；额外内容生成字段被拒绝。 */
export const agentGeneratedResultProviderSchema = checkupAgentResultSchema
export const agentGeneratedResultSchema = checkupAgentResultSchema

/** `generateResult` 的严格业务输出 */
export type AgentGeneratedResult = z.infer<typeof agentGeneratedResultSchema>

/** `generateResult` 输入；量化值只能来自分析算法 */
export interface AgentResultGenerationInput {
    riskCandidates?: readonly import('../checkup/analysis.risk-candidates').RiskCandidate[]
    reviewFrameTimes?: readonly number[]
    scoreContext?: { score: number | null; reference: unknown }
    materialDescriptions?: import('../materials/analysis.material').UnderstoodMaterials
    comparisonFacts?: readonly import('../checkup/analysis.differences').NoteDifference[]
    comparisonNotes?: readonly import('../checkup/analysis.checkup.contract').CheckupReference[]
    task: StandardAnalysisTask
    topicEvidence?: CheckupTopicEvidence
    webResearch?: AnalysisWebResearchSnapshot
    images: AgentImageAsset[]
    videoEvidence?: AgentVideoEvidence | null
    signal: AbortSignal
    correlation: AgentProviderCorrelation
}

/** 最终 Agent 已返回非法结构后唯一允许的一次修复输入。 */
export interface AgentOutputRepairInput {
    generationInput: AgentResultGenerationInput
    mode: 'fields' | 'full'
    fieldPaths: string[]
    ruleId: string
    originalOutput: unknown
}

/** 内容决策 Agent 的供应商无关接口 */
export interface AgentProvider {
    understandMaterial?(
        input: import('../materials/analysis.material').MaterialUnderstandingInput,
    ): Promise<unknown>
    formConversationTurn?(input: AgentConversationTurnInput): Promise<unknown>
    generateResult(input: AgentResultGenerationInput): Promise<unknown>
    repairResult?(input: AgentOutputRepairInput): Promise<unknown>
}

/** 严格读取一整个任务形成结果；调用方不得在失败时消费任何局部字段。 */
export function readAgentConversationTurn(value: unknown): AgentConversationTurn {
    const wire = agentConversationTurnWireSchema.safeParse(value)
    if (!wire.success) {
        throw new AgentContractError('Agent 多轮任务形成结构无效', {
            validationFieldPaths: wire.error.issues.map((issue) => issue.path.join('.')),
            ruleId: 'form-conversation-turn.schema',
            debugDetails: {
                stage: 'form-conversation-turn.contract-validation',
                ...agentOutputDebugSummary(value),
                issues: wire.error.issues.map((issue) => ({
                    path: issue.path.join('.'),
                    code: issue.code,
                })),
            },
        })
    }
    const draftPatch = Object.fromEntries(
        wire.data.draftPatch.map((operation) => [
            operation.field,
            operation.operation === 'clear'
                ? { operation: 'clear' as const }
                : {
                      operation: 'set' as const,
                      value: operation.value as string | string[],
                      source: operation.source as 'user_input' | 'agent_inference',
                  },
        ]),
    )
    const parsed = agentConversationTurnSchema.safeParse({
        ...wire.data,
        draftPatch,
    })
    if (!parsed.success) {
        throw new AgentContractError('Agent 多轮任务形成结构无效', {
            validationFieldPaths: parsed.error.issues.map((issue) => issue.path.join('.')),
            ruleId: 'form-conversation-turn.schema',
            debugDetails: {
                stage: 'form-conversation-turn.contract-validation',
                ...agentOutputDebugSummary(value),
                issues: parsed.error.issues.map((issue) => ({
                    path: issue.path.join('.'),
                    code: issue.code,
                })),
            },
        })
    }
    return parsed.data
}

/** 读取已签名草稿准备数据；不生成或补写笔记。 */
export function readAgentDraftPreparation(value: unknown): AgentDraftPreparation {
    const parsed = agentDraftPreparationSchema.safeParse(value)
    if (!parsed.success) {
        throw new AgentContractError('Agent 草稿准备结构无效', {
            validationFieldPaths: parsed.error.issues.map((issue) => issue.path.join('.')),
            ruleId: 'prepare-draft.schema',
            debugDetails: {
                stage: 'prepare-draft.contract-validation',
                ...agentOutputDebugSummary(value),
                issues: parsed.error.issues.map((issue) => ({
                    path: issue.path.join('.'),
                    code: issue.code,
                })),
            },
        })
    }
    return parsed.data
}

/** 校验独立体检评审，不接受内容方案或内部评分来源。 */
export function readAgentGeneratedResult(
    value: unknown,
    input?: AgentResultGenerationInput,
): AgentGeneratedResult {
    if (readAgentUnparseableOutput(value) !== null) {
        throw new AgentContractError('Agent 最终输出无法解析', {
            validationFieldPaths: [],
            ruleId: 'generate-result.unparseable',
        })
    }
    const normalizedValue = normalizeAgentGeneratedOutput(value)
    const transport = agentGeneratedResultProviderSchema.safeParse(normalizedValue)
    if (!transport.success) {
        const strictCandidate = agentGeneratedResultSchema.safeParse(normalizedValue)
        const issues = strictCandidate.success
            ? transport.error.issues
            : strictCandidate.error.issues
        throw new AgentContractError('Agent 体检评审结构无效', {
            validationFieldPaths: issues.map((issue) => issue.path.join('.')),
            ruleId: 'generate-result.schema',
            debugDetails: {
                stage: 'generate-result.contract-validation',
                issues: issues.map((issue) => ({
                    path: issue.path.join('.'),
                    code: issue.code,
                    message: issue.message,
                })),
            },
        })
    }
    const expanded = agentGeneratedResultSchema.safeParse(transport.data)
    if (!expanded.success) {
        throw new AgentContractError('Agent 体检评审结构无效', {
            validationFieldPaths: expanded.error.issues.map((issue) => issue.path.join('.')),
            ruleId: 'generate-result.schema',
        })
    }
    const parsed = expanded.data

    const qualityViolations = findGeneratedResultQualityViolations(parsed, input)
    if (qualityViolations.length > 0) {
        throw new AgentContractError('Agent 体检评审的依据或定位无效', {
            validationFieldPaths: [
                ...new Set(qualityViolations.map((violation) => violation.path)),
            ],
            ruleId: 'generate-result.publishable-content',
            debugDetails: {
                stage: 'generate-result.publishable-validation',
                issues: qualityViolations,
            },
        })
    }
    return parsed
}
