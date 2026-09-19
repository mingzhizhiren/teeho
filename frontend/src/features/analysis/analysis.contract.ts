import { z } from 'zod'

/** 工作台支持的分析输入模式。 */
export const analysisInputModeSchema = z.enum(['agent', 'custom'])

/** 标准任务字段值的来源。 */
export const taskFieldSourceSchema = z.enum([
    'user_input',
    'agent_inference',
    'workspace_default',
    'track_default',
    'system_default',
])

/** 标准任务允许使用的字段名。 */
export const taskFieldNameSchema = z.enum(['track', 'customTrackName', 'title', 'body', 'topics'])

/** 草稿和标准任务字段允许保存的值。 */
export const taskFieldValueSchema = z.union([z.string(), z.array(z.string()), z.null()])

const taskFieldOptionSchema = z.object({
    value: z.string(),
    labelKey: z.string(),
    enabled: z.boolean(),
})

const taskFieldDefinitionSchema = z.object({
    name: taskFieldNameSchema,
    kind: z.enum(['select', 'text', 'textarea', 'tags']),
    order: z.number(),
    labelKey: z.string(),
    helpKey: z.string(),
    defaultValue: taskFieldValueSchema,
    countsAsInput: z.boolean(),
    options: z.array(taskFieldOptionSchema).optional(),
    visibleWhen: z
        .object({
            field: taskFieldNameSchema,
            equals: z.string(),
        })
        .optional(),
    validation: z
        .object({
            maxLength: z.number().optional(),
            maxItems: z.number().optional(),
            itemMaxLength: z.number().optional(),
        })
        .optional(),
})

export const analysisTrackDefinitionSchema = z.object({
    id: z.string().min(1),
    code: z.number().int().min(0),
    order: z.number().int().positive(),
    labelKey: z.string().min(1),
    keywords: z.array(z.string().min(1)),
    custom: z.boolean(),
})

/** 服务端公开的版本化任务配置。 */
export const analysisTaskConfigSchema = z.object({
    version: z.string(),
    fields: z.array(taskFieldDefinitionSchema),
    tracks: z.array(analysisTrackDefinitionSchema).min(1),
    trackDefaults: z.record(z.string(), z.partialRecord(taskFieldNameSchema, taskFieldValueSchema)),
    uploads: z.object({
        allowedMediaTypes: z.array(z.enum(['image/jpeg', 'image/png', 'image/webp'])),
        maxFiles: z.number(),
        maxFileBytes: z.number(),
        maxTotalBytes: z.number(),
        maxPixels: z.number(),
        retentionSeconds: z.number(),
        maxImagesPerMinute: z.number().int().positive(),
        videoEnabled: z.boolean(),
        video: z.object({
            allowedMediaTypes: z.array(z.enum(['video/mp4', 'video/quicktime'])),
            maxFileBytes: z.number().int().positive(),
            maxUploadsPerMinute: z.number().int().positive(),
            pointCost: z.number().int().nonnegative().default(0),
        }),
    }),
    runtime: z.object({
        mode: z.enum(['cloud', 'local']),
        pointsEnabled: z.boolean().default(false),
        preparationRequestTimeoutMs: z.number(),
    }),
})

/** 预览与正式提交共用的草稿请求体。 */
export const analysisDraftPayloadSchema = z
    .object({
        inputMode: analysisInputModeSchema,
        rawText: z.string(),
        imageReferences: z.array(z.string()),
        coverReference: z.string().uuid().optional(),
        videoReference: z.string().uuid().optional(),
        fields: z.partialRecord(taskFieldNameSchema, taskFieldValueSchema),
    })
    .superRefine((draft, context) => {
        if (draft.videoReference && draft.imageReferences.length > 0) {
            context.addIssue({
                code: 'custom',
                path: ['videoReference'],
                message: '视频任务不能混入图片',
            })
        }
    })

export const analysisMediaStateSchema = z.enum([
    'awaiting_upload',
    'uploaded',
    'processing',
    'ready',
    'failed',
    'expired',
    'deleting',
    'deleted',
    'cleanup_failed',
])

export const analysisMediaAssetSchema = z.object({
    id: z.string().uuid(),
    fileName: z.string(),
    state: analysisMediaStateSchema,
    mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']).nullable(),
    byteSize: z.number().int().positive().nullable(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    contentHash: z
        .string()
        .regex(/^[0-9a-f]{64}$/u)
        .nullable(),
    errorCode: z.string().nullable(),
    expiresAt: z.string(),
})

export const analysisMediaUploadSessionSchema = z.object({
    sessionId: z.string().uuid(),
    assets: z.array(
        z.object({
            id: z.string().uuid(),
            fileName: z.string(),
            state: z.literal('awaiting_upload'),
            uploadExpiresAt: z.string(),
            uploadUrl: z.string().url(),
            uploadToken: z.string(),
        }),
    ),
})

export const analysisMediaUploadSessionDataSchema = z.object({
    session: analysisMediaUploadSessionSchema,
})

export const analysisMediaAssetDataSchema = z.object({
    asset: analysisMediaAssetSchema,
})

export const analysisMediaStatusesDataSchema = z.object({
    assets: z.array(analysisMediaAssetSchema),
})

/** 视频预处理状态的运行时校验模式。 */
export const analysisVideoStateSchema = z.enum([
    'awaiting_upload',
    'uploaded',
    'queued',
    'processing',
    'ready',
    'deterministic_failed',
    'technical_failed',
    'cancelled',
    'expired',
    'deleting',
    'deleted',
    'cleanup_failed',
])

/** 任务草稿中视频素材的运行时校验模式。 */
export const analysisVideoSchema = z.object({
    id: z.string().uuid(),
    fileName: z.string(),
    state: analysisVideoStateSchema,
    queuePosition: z.number().int().positive().nullable(),
    processingAttemptCount: z.number().int().nonnegative(),
    errorCode: z.string().nullable(),
    evidenceId: z.string().uuid().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
})

/** 视频上传会话的运行时校验模式。 */
export const analysisVideoUploadSessionSchema = z.object({
    sessionId: z.string().uuid(),
    video: z.object({
        id: z.string().uuid(),
        fileName: z.string(),
        state: z.literal('awaiting_upload'),
        upload: z.object({
            endpoint: z.string().url(),
            signature: z.string().min(1),
            bucketName: z.literal('analysis-video'),
            objectName: z.string().min(1),
            expiresAt: z.string(),
        }),
    }),
})

/** 视频上传会话接口数据的运行时校验模式。 */
export const analysisVideoUploadSessionDataSchema = z.object({
    session: analysisVideoUploadSessionSchema,
})

/** 视频素材接口数据的运行时校验模式。 */
export const analysisVideoDataSchema = z.object({
    video: analysisVideoSchema,
})

export const resolvedTaskFieldSchema = z.object({
    value: taskFieldValueSchema,
    source: taskFieldSourceSchema,
})

const resolvedField = <Schema extends z.ZodTypeAny>(value: Schema) =>
    z.object({ value, source: taskFieldSourceSchema }).strict()

/** 每轮完整保存五个草稿字段；尚未提供的笔记内容保持空值。 */
export const resolvedTaskFieldsSchema = z
    .object({
        track: resolvedField(z.string().min(1)),
        customTrackName: resolvedField(z.string().min(1).nullable()),
        title: resolvedField(z.string().min(1).nullable()),
        body: resolvedField(z.string().nullable()),
        topics: resolvedField(z.array(z.string().min(1))),
    })
    .strict()

const standardAnalysisTaskCanonicalSchema = z.object({
    structureVersion: z.literal('analysis-task.v6'),
    contentKind: z.enum(['image', 'video']),
    videoEvidence: z
        .object({
            assetId: z.string().uuid(),
            evidenceId: z.string().uuid(),
            evidenceVersion: z.literal('video-evidence.v1'),
            originalSha256: z.string().regex(/^[0-9a-f]{64}$/u),
        })
        .nullable()
        .optional(),
    rawText: z.string(),
    imageReferences: z.array(z.string()),
    coverReference: z.string().uuid().optional(),
    publishedAt: z.string().date().optional(),
    fields: resolvedTaskFieldsSchema.extend({
        title: resolvedField(z.string().trim().min(1)),
        body: resolvedField(z.string().trim()),
        topics: resolvedField(z.array(z.string().trim().min(1)).min(1)),
    }),
})

/** 正式体检仅消费当前版本的冻结完整笔记。 */
export const standardAnalysisTaskSchema = standardAnalysisTaskCanonicalSchema

export { analysisResultSchema } from './analysis.checkup-contract'
import { analysisResultSchema } from './analysis.checkup-contract'
const analysisFailureSchema = z.object({
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
    message: z.string(),
})

/** 工作台读取的完整远程分析任务。 */
export const analysisTaskSchema = z.object({
    id: z.string().min(1),
    inputMode: analysisInputModeSchema,
    inputFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
    status: z.enum([
        'researching',
        'queued',
        'processing',
        'retrying',
        'succeeded',
        'technical_failed',
        'insufficient_points',
        'abandoned',
        'cancelled',
    ]),
    structureConfigVersion: z.string().min(1),
    standardTask: standardAnalysisTaskSchema,
    result: analysisResultSchema.nullable(),
    resultVersion: z.number().int().positive().nullable(),
    failure: analysisFailureSchema.nullable(),
    pointCost: z.number().int().nonnegative().default(0),
    chargedPoints: z.number().int().nonnegative().nullable().optional(),
    attemptCount: z.number().int().nonnegative(),
    manualRetryCount: z.number().int().nonnegative(),
    queuePosition: z.number().int().positive().nullable(),
    expectedDurationSeconds: z.number().int().positive(),
    createdAt: z.string().min(1),
    queuedAt: z.string().min(1),
    startedAt: z.string().nullable(),
    updatedAt: z.string().min(1),
    completedAt: z.string().nullable(),
    cancellationReason: z.enum(['maintenance', 'refund']).nullable().optional(),
})

/** Agent 对当前输入的受理门禁结果。 */
export const analysisInputAcceptanceSchema = z.discriminatedUnion('status', [
    z.object({
        status: z.literal('accepted'),
        message: z.null(),
        clarificationQuestion: z.null(),
    }),
    z.object({
        status: z.literal('clarification_required'),
        message: z.string(),
        clarificationQuestion: z.string(),
    }),
    z.object({
        status: z.enum(['invalid', 'out_of_scope']),
        message: z.string(),
        clarificationQuestion: z.null(),
    }),
])

/** 任务配置接口的 data 载荷。 */
export const analysisTaskConfigDataSchema = z.object({
    config: analysisTaskConfigSchema,
})

/** 草稿预览接口的 data 载荷。 */
export const analysisDraftPreviewDataSchema = z.object({
    acceptance: analysisInputAcceptanceSchema,
    standardTask: standardAnalysisTaskSchema.nullable(),
    preparationId: z.string().nullable(),
})

/** 正式提交接口的 data 载荷。 */
export const analysisSubmissionDataSchema = z.object({
    acceptance: analysisInputAcceptanceSchema,
    task: analysisTaskSchema.nullable(),
})

/** 单任务查询接口的 data 载荷。 */
export const analysisTaskDataSchema = z.object({
    task: analysisTaskSchema,
})

/** 最近任务查询接口的 data 载荷。 */
export const latestAnalysisTaskDataSchema = z.object({
    task: analysisTaskSchema.nullable(),
})

/** 任务列表接口的 data 载荷。 */
export const analysisTasksDataSchema = z.object({
    tasks: z.array(analysisTaskSchema),
})

/** 已登记等待 PostgreSQL 定时清理的临时图片数量。 */
export const analysisAssetCleanupOutcomeSchema = z.object({
    requested: z.number(),
})

/** 临时图片清理接口的 data 载荷。 */
export const analysisAssetCleanupDataSchema = z.object({
    cleanup: analysisAssetCleanupOutcomeSchema,
})

/** 工作台支持的分析输入模式类型。 */
export type AnalysisInputMode = z.infer<typeof analysisInputModeSchema>
/** 标准任务字段来源类型。 */
export type TaskFieldSource = z.infer<typeof taskFieldSourceSchema>
/** 标准任务字段名类型。 */
export type TaskFieldName = z.infer<typeof taskFieldNameSchema>
/** 草稿和标准任务字段值类型。 */
export type TaskFieldValue = z.infer<typeof taskFieldValueSchema>
/** 可选任务字段选项。 */
export type TaskFieldOption = z.infer<typeof taskFieldOptionSchema>
/** 服务端下发的任务字段定义。 */
export type TaskFieldDefinition = z.infer<typeof taskFieldDefinitionSchema>
/** 后端目录下发的稳定赛道定义。 */
export type AnalysisTrackDefinition = z.infer<typeof analysisTrackDefinitionSchema>
/** 服务端公开的版本化任务配置类型。 */
export type AnalysisTaskConfig = z.infer<typeof analysisTaskConfigSchema>
/** 预览与正式提交共用的草稿载荷类型。 */
export type AnalysisDraftPayload = z.infer<typeof analysisDraftPayloadSchema>
export type AnalysisMediaAsset = z.infer<typeof analysisMediaAssetSchema>
export type AnalysisMediaUploadSession = z.infer<typeof analysisMediaUploadSessionSchema>
/** 任务草稿中的视频素材。 */
export type AnalysisVideo = z.infer<typeof analysisVideoSchema>
/** 视频上传会话。 */
export type AnalysisVideoUploadSession = z.infer<typeof analysisVideoUploadSessionSchema>
/** 标准任务中带来源的已解析字段。 */
export type ResolvedTaskField = z.infer<typeof resolvedTaskFieldSchema>
export type ResolvedTaskFields = z.infer<typeof resolvedTaskFieldsSchema>
/** 执行使用的标准任务快照类型。 */
export type StandardAnalysisTask = z.infer<typeof standardAnalysisTaskSchema>
/** 算法产生的公开量化报告。 */
/** 一次成功分析的公开结果类型。 */
export type AnalysisResult = z.infer<typeof analysisResultSchema>
/** 工作台读取的远程分析任务类型。 */
export type AnalysisTask = z.infer<typeof analysisTaskSchema>
/** Agent 输入受理门禁结果类型。 */
export type AnalysisInputAcceptance = z.infer<typeof analysisInputAcceptanceSchema>
/** 已登记等待 PostgreSQL 定时清理的临时图片数量类型。 */
export type AnalysisAssetCleanupOutcome = z.infer<typeof analysisAssetCleanupOutcomeSchema>

/** 创建任务请求的幂等凭据与后端公开等待边界。 */
export interface AnalysisSubmissionRequestOptions {
    preparationId?: string
    submissionId: string
    confirmationRevision: number
    conversationSession: {
        sessionId: string
        generation: number
        browserInstanceId: string
    } | null
    timeoutMs: number
}
