import { z } from 'zod'
import { metricMetadataSchema } from '../customization/metric-metadata'

import { VIDEO_RULES } from '../config/constants'
import {
    analysisTaskConfig,
    analysisTaskStructureVersion,
    type TaskFieldName,
    type TaskFieldValue,
} from './analysis.config'
import {
    analysisExecutionConstraints,
    analysisInputConstraints,
    analysisUploadConstraints,
} from './analysis.constants'
import { checkupSampling } from './checkup/analysis.checkup.constants'
import { checkupReportSchema } from './checkup/analysis.checkup.contract'
import { checkupTopicEvidenceSchema } from './checkup/analysis.checkup.topics'
import { MATERIAL_LIMITS, materialDescriptionSchema } from './materials/analysis.material.contract'
import { secondaryTrackCodesSchema } from './tracks/analysis.track-selection'
import { analysisTrackIdSchema } from './tracks/analysis.tracks'

export { analysisTaskStructureVersion }
export type { TaskFieldName, TaskFieldValue }

/** 用户任务主输入的最大字符数。 */
export const analysisRawTextMaxLength = analysisInputConstraints.rawTextMaxLength

/** 工作台输入模式；模式只描述入口，不改变标准任务结构。 */
export const analysisInputModeSchema = z.enum(['agent', 'custom'])

/** 标准任务字段值的来源。 */
export const taskFieldSourceSchema = z.enum([
    'user_input',
    'agent_inference',
    'workspace_default',
    'track_default',
    'system_default',
])

/** 创建会清理空白文本的可选字符串校验器 */
const optionalText = (maxLength: number) =>
    z
        .string()
        .max(maxLength)
        .refine((value) => value.trim().length > 0, '字段内容不能为空')
        .optional()

const topicsSchema = z
    .array(
        z
            .string()
            .max(analysisInputConstraints.fields.existingTopicMaxLength)
            .refine((value) => value.trim().length > 0, '话题不能为空'),
    )
    .max(analysisInputConstraints.fields.topicsMaxItems)

/** 配置化任务字段的浏览器输入结构。 */
export const analysisDraftFieldsSchema = z
    .object({
        track: analysisTrackIdSchema.optional(),
        customTrackName: optionalText(analysisInputConstraints.fields.customTrackNameMaxLength),
        title: optionalText(analysisInputConstraints.fields.titleMaxLength),
        body: z.string().max(analysisInputConstraints.fields.bodyMaxLength).optional(),
        topics: topicsSchema.optional(),
    })
    .strict()

/** 判断可选文本是否包含有效内容 */
function hasValue(value: TaskFieldValue | undefined) {
    if (typeof value === 'string') {
        return value.trim().length > 0
    }
    if (Array.isArray(value)) {
        return value.some((item) => item.trim().length > 0)
    }
    return value !== null && value !== undefined
}

/** 判断草稿是否具有可交给 Provider 的文字、图片或配置内容。 */
export function hasEffectiveAnalysisContent(input: {
    rawText: string
    imageReferences: string[]
    videoReference?: string
    fields: Partial<Record<TaskFieldName, TaskFieldValue>>
}) {
    if (input.rawText.trim() || input.imageReferences.length > 0 || input.videoReference) {
        return true
    }
    return analysisTaskConfig.fields.some(
        (field) => field.countsAsInput && hasValue(input.fields[field.name]),
    )
}

/** 草稿状态可为空，但始终校验字段与素材之间的一致性。 */
export const analysisDraftStateSchema = z
    .object({
        inputMode: analysisInputModeSchema,
        rawText: z.string().max(analysisRawTextMaxLength),
        imageReferences: z
            .array(z.string().uuid('图片引用无效'))
            .max(analysisUploadConstraints.maxFiles)
            .default([]),
        videoReference: z.string().uuid('视频引用无效').optional(),
        coverReference: z.string().uuid('封面引用无效').optional(),
        fields: analysisDraftFieldsSchema.default({}),
    })
    .strict()
    .superRefine((draft, context) => {
        if (
            draft.coverReference &&
            !draft.videoReference &&
            !draft.imageReferences.includes(draft.coverReference)
        ) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['coverReference'],
                message: '图文封面必须属于当前图片集合',
            })
        }
        if (draft.videoReference && draft.imageReferences.length > 0) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['videoReference'],
                message: '视频任务不能混入图片',
            })
        }
        if (draft.fields.track === 'custom' && !draft.fields.customTrackName?.trim()) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['fields', 'customTrackName'],
                message: '选择其他赛道时必须填写赛道名称',
            })
        }
    })

/** 提交给 Provider 或定制模式的输入必须包含有效内容。 */
export const analysisDraftSchema = analysisDraftStateSchema.superRefine((draft, context) => {
    if (!hasEffectiveAnalysisContent(draft)) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['rawText'],
            message: '请提供文字、图片或其他有效任务内容',
        })
    }
})

/** 创建解析后必填任务字段的校验器 */
const resolvedField = <Schema extends z.ZodTypeAny>(valueSchema: Schema) =>
    z
        .object({
            value: valueSchema,
            source: taskFieldSourceSchema,
        })
        .strict()

/** 固化任务的全部已解析字段。 */
export const resolvedTaskFieldsSchema = z
    .object({
        track: resolvedField(analysisTrackIdSchema),
        customTrackName: resolvedField(
            z
                .string()
                .trim()
                .min(1)
                .max(analysisInputConstraints.fields.customTrackNameMaxLength)
                .nullable(),
        ),
        title: resolvedField(
            z.string().trim().min(1).max(analysisInputConstraints.fields.titleMaxLength).nullable(),
        ),
        body: resolvedField(
            z.string().trim().max(analysisInputConstraints.fields.bodyMaxLength).nullable(),
        ),
        topics: resolvedField(topicsSchema),
    })
    .strict()

const taskEvidenceSchema = z
    .object({
        rawText: z.string().max(analysisRawTextMaxLength),
        imageReferences: z.array(z.string().uuid()).max(analysisUploadConstraints.maxFiles),
        title: z.string().max(analysisInputConstraints.fields.titleMaxLength).nullable(),
        body: z.string().max(analysisInputConstraints.fields.bodyMaxLength).nullable(),
        topics: z
            .array(z.string().max(analysisInputConstraints.fields.existingTopicMaxLength))
            .max(analysisInputConstraints.fields.topicsMaxItems),
    })
    .strict()

/** 视频任务写入不可变快照的最小证据身份。 */
export const videoEvidenceReferenceSchema = z
    .object({
        assetId: z.string().uuid(),
        evidenceId: z.string().uuid(),
        evidenceVersion: z.literal(VIDEO_RULES.evidenceVersion),
        originalSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    })
    .strict()

const standardTaskFields = {
    rawText: z.literal(''),
    imageReferences: z.array(z.string().uuid()).max(analysisUploadConstraints.maxFiles),
    fields: resolvedTaskFieldsSchema.extend({
        title: resolvedField(
            z.string().trim().min(1).max(analysisInputConstraints.fields.titleMaxLength),
        ),
        body: resolvedField(z.string().trim().max(analysisInputConstraints.fields.bodyMaxLength)),
        topics: resolvedField(topicsSchema.min(1)),
    }),
}

const standardAnalysisTaskCanonicalSchema = z
    .object({
        structureVersion: z.literal(analysisTaskStructureVersion),
        analysisIntent: z.enum(['daily', 'guide', 'story', 'review', 'other']).optional(),
        secondaryTracks: secondaryTrackCodesSchema.optional(),
        materialSummary: z.string().max(MATERIAL_LIMITS.summary).optional(),
        coverGeometry: z
            .object({ width: z.number().int().positive(), height: z.number().int().positive() })
            .strict()
            .optional(),

        coverReference: z.string().uuid('封面引用无效').optional(),
        publishedAt: z.string().date().optional(),
        contentKind: z.enum(['image', 'video']),
        videoEvidence: videoEvidenceReferenceSchema.nullable(),
        ...standardTaskFields,
        evidence: taskEvidenceSchema,
    })
    .strict()
    .superRefine((task, context) => {
        if (
            task.contentKind === 'image' &&
            task.coverReference &&
            !task.imageReferences.includes(task.coverReference)
        ) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['coverReference'],
                message: '图文封面必须属于当前图片集合',
            })
        }
        if (task.fields.track.value === 'custom' && !task.fields.customTrackName.value) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['fields', 'customTrackName'],
                message: '自定义赛道缺少名称',
            })
        }
        if (task.contentKind === 'video') {
            if (!task.videoEvidence) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['videoEvidence'],
                    message: '视频任务缺少证据引用',
                })
            }
            if (task.imageReferences.length > 0) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['imageReferences'],
                    message: '视频任务不能混入图片',
                })
            }
        } else if (task.videoEvidence) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['videoEvidence'],
                message: '非视频任务不能包含视频证据',
            })
        }
    })

/** 固化后交给算法与 Provider 的完整笔记；不接收旧创作任务。 */
export const standardAnalysisTaskSchema = standardAnalysisTaskCanonicalSchema

const providerUsageSchema = z
    .object({
        inputTokens: z.number().int().nonnegative().nullable(),
        textInputTokens: z.number().int().nonnegative().nullable(),
        imageInputTokens: z.number().int().nonnegative().nullable(),
        cachedInputTokens: z.number().int().nonnegative().nullable(),
        reasoningTokens: z.number().int().nonnegative().nullable(),
        outputTokens: z.number().int().nonnegative().nullable(),
        totalTokens: z.number().int().nonnegative().nullable(),
    })
    .strict()

/** 仅用于运维追溯且永不进入用户 API 的执行信息。 */
export const analysisInternalExecutionTraceSchema = z
    .object({
        schemaVersion: z.literal('execution-trace.v4'),
        metricEvidence: z.record(metricMetadataSchema).optional(),
        pluginVersion: z
            .string()
            .regex(/^[0-9a-f]{64}$/u)
            .optional(),
        insightModelId: z.string().nullable().optional(),
        insightCoverDescription: materialDescriptionSchema.shape.description.nullable().optional(),
        provider: z.enum(['mock', 'codex-cli', 'openai', 'gemini']),
        model: z
            .string()
            .trim()
            .min(1)
            .max(analysisExecutionConstraints.trace.modelMaxLength)
            .nullable(),
        requestId: z.string().uuid(),
        executionId: z
            .string()
            .trim()
            .min(1)
            .max(analysisExecutionConstraints.trace.executionIdMaxLength)
            .nullable(),
        algorithmVersion: z
            .string()
            .trim()
            .min(1)
            .max(analysisExecutionConstraints.trace.versionMaxLength),
        evidenceSourceVersion: z
            .string()
            .trim()
            .min(1)
            .max(analysisExecutionConstraints.trace.versionMaxLength),
        generateResultPromptVersion: z
            .string()
            .trim()
            .min(1)
            .max(analysisExecutionConstraints.trace.versionMaxLength),
        taskStructureVersion: z.literal(analysisTaskStructureVersion),
        evidenceVersion: z.string().regex(/^[0-9a-f]{64}$/u),
        checkupFeatureHash: z.string().regex(/^[0-9a-f]{64}$/u),
        topicEvidence: checkupTopicEvidenceSchema,
        matchedNoteCount: z.number().int().nonnegative().max(checkupSampling.candidateLimit),
        usage: providerUsageSchema.nullable(),
    })
    .strict()

/** 用户 API 唯一可见的最新分析结果。 */
export const agentAnalysisResultSchema = checkupReportSchema

/** 分析任务技术失败信息；用户只收到稳定的通用文案。 */
export const analysisFailureSchema = z
    .object({
        code: z.enum([
            'agent_timeout',
            'agent_invalid_output',
            'insight_unavailable',
            'radar_unavailable',
            'no_reference_notes',
            'agent_failure',
            'image_expired',
            'video_evidence_expired',
            'insufficient_points',
        ]),
        message: z.string().min(1),
    })
    .strict()

/** 分析任务状态。 */
export const analysisTaskStatusSchema = z.enum([
    'researching',
    'queued',
    'processing',
    'retrying',
    'succeeded',
    'technical_failed',
    'insufficient_points',
    'abandoned',
    'cancelled',
])

export type AnalysisDraft = z.infer<typeof analysisDraftSchema>
export type AnalysisInputMode = z.infer<typeof analysisInputModeSchema>
export type TaskFieldSource = z.infer<typeof taskFieldSourceSchema>
export type ResolvedTaskField = z.infer<typeof resolvedTaskFieldsSchema>[TaskFieldName]
export type ResolvedTaskFields = z.infer<typeof resolvedTaskFieldsSchema>
/** 分析任务快照中的视频证据引用。 */
export type VideoEvidenceReference = z.infer<typeof videoEvidenceReferenceSchema>
export type StandardAnalysisTask = z.infer<typeof standardAnalysisTaskSchema>
export type AnalysisInternalExecutionTrace = z.infer<typeof analysisInternalExecutionTraceSchema>
export type AgentAnalysisResult = z.infer<typeof checkupReportSchema>
export type AnalysisFailure = z.infer<typeof analysisFailureSchema>
export type AnalysisTaskStatus = z.infer<typeof analysisTaskStatusSchema>
