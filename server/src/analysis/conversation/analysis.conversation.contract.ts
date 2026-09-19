import { z } from 'zod'

import { analysisInputConstraints, analysisUploadConstraints } from '../analysis.constants'
import {
    analysisDraftSchema,
    analysisDraftStateSchema,
    analysisRawTextMaxLength,
    resolvedTaskFieldsSchema,
    standardAnalysisTaskSchema,
} from '../analysis.schema'

const conversationHistoryMaxItems = 100
const conversationQuestionIdMaxLength = 80
const percentageMaximum = 100
const mutableDraftPatchFieldSchema = z.enum(['title', 'body', 'topics'])

const draftPatchSetOperationSchema = z
    .object({
        operation: z.literal('set'),
        value: z.union([z.string(), z.array(z.string())]),
        source: z.literal('user_input'),
    })
    .strict()

const draftPatchClearOperationSchema = z.object({ operation: z.literal('clear') }).strict()

const draftPatchOperationSchema = z.discriminatedUnion('operation', [
    draftPatchSetOperationSchema,
    draftPatchClearOperationSchema,
])

/** Provider 只可修改赛道之外的任务字段；字段缺席表示保持不变。 */
export const analysisConversationDraftPatchSchema = z
    .object({
        title: draftPatchOperationSchema.optional(),
        body: draftPatchOperationSchema.optional(),
        topics: draftPatchOperationSchema.optional(),
    })
    .strict()

const draftPatchWireOperationSchema = z
    .object({
        field: mutableDraftPatchFieldSchema,
        operation: z.enum(['set', 'clear']),
        value: z.union([z.string(), z.array(z.string()), z.null()]),
        source: z.literal('user_input').nullable(),
    })
    .strict()
    .superRefine((operation, context) => {
        if (operation.operation === 'set') {
            if (operation.value === null || operation.source === null) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['operation'],
                    message: 'set 必须携带 value 和 source',
                })
            }
            return
        }
        if (operation.value !== null || operation.source !== null) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['operation'],
                message: 'clear 的 value 和 source 必须为 null',
            })
        }
    })

export const analysisConversationDraftPatchWireSchema = z
    .array(draftPatchWireOperationSchema)
    .superRefine((operations, context) => {
        const fields = new Set<string>()
        operations.forEach((operation, index) => {
            if (fields.has(operation.field)) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: [index, 'field'],
                    message: '同一字段只能出现一次补丁操作',
                })
            }
            fields.add(operation.field)
        })
    })

/** 浏览器与 Provider 之间共享的完整、带来源任务草稿。 */
export const analysisConversationDraftSchema = z
    .object({
        schemaVersion: z.literal('analysis-conversation-draft.v1'),
        rawText: z.string().max(analysisRawTextMaxLength),
        fields: resolvedTaskFieldsSchema.extend({
            track: resolvedTaskFieldsSchema.shape.track.extend({
                value: resolvedTaskFieldsSchema.shape.track.shape.value.nullable(),
            }),
        }),
    })
    .strict()

/** 只允许成功受理过的用户消息、公开回复和 Agent 语义问题进入上下文。 */
export const analysisConversationMessageSchema = z
    .object({
        id: z.string().uuid(),
        role: z.enum(['user', 'agent_reply', 'agent_question']),
        text: z.string().trim().min(1).max(analysisRawTextMaxLength),
    })
    .strict()

const conversationImageMetadataSchema = z
    .object({
        reference: z.string().uuid(),
        mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        byteSize: z.number().int().positive(),
    })
    .strict()

const conversationVideoMetadataSchema = z
    .object({
        reference: z.string().uuid(),
        mediaType: z.enum(['video/mp4', 'video/quicktime']),
        byteSize: z.number().int().positive(),
    })
    .strict()

/** Browser-owned identity used for authority reconciliation and exact clears. */
export const analysisConversationSessionIdentitySchema = z
    .object({
        sessionId: z.string().uuid(),
        generation: z.number().int().positive(),
        browserInstanceId: z.string().uuid(),
    })
    .strict()

/** Plus 每轮任务形成请求；正文只在本次请求内使用，后端不得持久化。 */
export const analysisConversationTurnRequestSchema = z
    .object({
        schemaVersion: z.literal('analysis-conversation-turn-request.v1'),
        session: analysisConversationSessionIdentitySchema.extend({
            requestId: z.string().uuid(),
        }),
        history: z.array(analysisConversationMessageSchema).max(conversationHistoryMaxItems),
        message: z.string().trim().min(1).max(analysisRawTextMaxLength),
        draft: analysisDraftSchema,
        completeDraft: analysisConversationDraftSchema,
        contentKind: z.enum(['text', 'image', 'video']),
        media: z
            .object({
                images: z
                    .array(conversationImageMetadataSchema)
                    .max(analysisUploadConstraints.maxFiles),
                video: conversationVideoMetadataSchema.nullable(),
            })
            .strict(),
    })
    .strict()

/** Provider 可以请求的受控任务形成动作。 */
export const agentConversationActionSchema = z.enum([
    'ask_questions',
    'draft_ready',
    'defer_media_analysis',
    'out_of_scope',
    'task_submitted',
])

/** 缺项问题不包含代写或推断建议。 */
export const agentConversationQuestionSchema = z
    .object({
        id: z.string().trim().min(1).max(conversationQuestionIdMaxLength),
        field: z.enum(['title', 'body', 'topics']).nullable(),
        text: z
            .string()
            .trim()
            .min(1)
            .max(analysisInputConstraints.clarification.questionMaxLength),
        suggestedValue: z.null(),
    })
    .strict()

/** Codex 任务形成回合的完整、不可部分消费结果。 */
function validateConversationTurnRelationships(
    result: {
        action: z.infer<typeof agentConversationActionSchema>
        questions: z.infer<typeof agentConversationQuestionSchema>[]
    },
    context: z.RefinementCtx,
) {
    if (result.action === 'ask_questions' && result.questions.length === 0) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['questions'],
            message: '询问动作必须包含至少一个缺项问题',
        })
    }
    if (result.action !== 'ask_questions' && result.questions.length > 0) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['questions'],
            message: '非询问动作不能夹带语义问题',
        })
    }
}

export const agentConversationTurnSchema = z
    .object({
        action: agentConversationActionSchema,
        assistantMessage: z.null(),
        questions: z.array(agentConversationQuestionSchema),
        draftPatch: analysisConversationDraftPatchSchema,
    })
    .strict()
    .superRefine((result, context) => validateConversationTurnRelationships(result, context))

/** 真实 Provider 使用固定键 operation 数组，解析后立即规范化为领域补丁映射。 */
export const agentConversationTurnWireSchema = z
    .object({
        action: agentConversationActionSchema,
        assistantMessage: z.null(),
        questions: z.array(agentConversationQuestionSchema),
        draftPatch: analysisConversationDraftPatchWireSchema,
    })
    .strict()
    .superRefine((result, context) => validateConversationTurnRelationships(result, context))

const analysisConversationTokenBudgetSchema = z
    .object({
        normalTokenBudget: z.number().int().positive(),
        finalDraftTokenReserve: z.number().int().nonnegative(),
        consumedTokens: z.number().int().nonnegative(),
        percentage: z.number().int().min(0).max(percentageMaximum),
        tone: z.enum(['green', 'yellow', 'red']),
        exhausted: z.boolean(),
        thresholds: z
            .object({
                yellow: z.number().int().min(0).max(percentageMaximum),
                red: z.number().int().min(0).max(percentageMaximum),
                exhausted: z.number().int().min(0).max(percentageMaximum),
            })
            .strict(),
    })
    .strict()

const analysisConversationRollingUsageSchema = z
    .object({
        exhausted: z.boolean(),
        retryAt: z.string().datetime({ offset: true }).nullable(),
        retryAfterSeconds: z.number().int().nonnegative(),
        canUpgrade: z.boolean(),
    })
    .strict()

/** 临时邮箱保存的完整、可再次原子消费的回合结果。 */
export const analysisConversationTurnResultSchema = z
    .object({
        schemaVersion: z.literal('analysis-conversation-turn-result.v1'),
        action: agentConversationActionSchema,
        assistantMessage: z.null(),
        questions: z.array(agentConversationQuestionSchema),
        completeDraft: analysisConversationDraftSchema,
        effectiveDraft: analysisDraftStateSchema,
        standardTask: standardAnalysisTaskSchema.nullable(),
        preparationId: z.string().min(1).nullable(),
        session: analysisConversationSessionIdentitySchema,
        tokenBudget: analysisConversationTokenBudgetSchema.nullable(),
        rollingUsage: analysisConversationRollingUsageSchema,
    })
    .strict()

export const analysisConversationTurnRecoveryRequestSchema = z
    .object({
        turnId: z.string().uuid(),
        session: analysisConversationSessionIdentitySchema,
    })
    .strict()

export type AnalysisConversationTurnResult = z.infer<typeof analysisConversationTurnResultSchema>

export type AnalysisConversationDraft = z.infer<typeof analysisConversationDraftSchema>
export type AnalysisConversationMessage = z.infer<typeof analysisConversationMessageSchema>
export type AnalysisConversationTurnRequest = z.infer<typeof analysisConversationTurnRequestSchema>
export type AnalysisConversationSessionIdentity = z.infer<
    typeof analysisConversationSessionIdentitySchema
>
export type AgentConversationTurn = z.infer<typeof agentConversationTurnSchema>
export type AnalysisConversationDraftPatch = z.infer<typeof analysisConversationDraftPatchSchema>
