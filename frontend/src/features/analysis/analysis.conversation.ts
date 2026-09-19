import { z } from 'zod'

import {
    analysisDraftPayloadSchema,
    resolvedTaskFieldsSchema,
    standardAnalysisTaskSchema,
    taskFieldNameSchema,
    type AnalysisDraftPayload,
    type AnalysisTaskConfig,
    type StandardAnalysisTask,
} from './analysis.contract'
import { analysisUiConstraints } from './analysis.constants'
import type { AnalysisContentKind } from './taskDraft'

export const analysisConversationDraftSchema = z
    .object({
        schemaVersion: z.literal('analysis-conversation-draft.v1'),
        rawText: z.string(),
        fields: resolvedTaskFieldsSchema.extend({
            track: resolvedTaskFieldsSchema.shape.track.extend({
                value: resolvedTaskFieldsSchema.shape.track.shape.value.nullable(),
            }),
        }),
    })
    .strict()

export const analysisConversationMessageSchema = z
    .object({
        id: z.string().uuid(),
        role: z.enum(['user', 'agent_reply', 'agent_question', 'agent_topic_switch']),
        text: z.string().trim().min(1),
    })
    .strict()

const agentConversationQuestionSchema = z
    .object({
        id: z.string().min(1),
        field: taskFieldNameSchema.exclude(['track', 'customTrackName']).nullable(),
        text: z.string().trim().min(1),
        suggestedValue: z.null(),
    })
    .strict()

const coreConversationQuestionFields = new Set(['title', 'body', 'topics'])

export const analysisConversationSessionIdentitySchema = z
    .object({
        sessionId: z.string().uuid(),
        generation: z.number().int().positive(),
        browserInstanceId: z.string().uuid(),
    })
    .strict()

export const analysisConversationTokenBudgetSchema = z
    .object({
        normalTokenBudget: z.number().int().positive(),
        finalDraftTokenReserve: z.number().int().nonnegative(),
        consumedTokens: z.number().int().nonnegative(),
        percentage: z.number().int().min(0).max(analysisUiConstraints.percentageComplete),
        tone: z.enum(['green', 'yellow', 'red']),
        exhausted: z.boolean(),
        thresholds: z
            .object({
                yellow: z.number().int().min(0).max(analysisUiConstraints.percentageComplete),
                red: z.number().int().min(0).max(analysisUiConstraints.percentageComplete),
                exhausted: z.number().int().min(0).max(analysisUiConstraints.percentageComplete),
            })
            .strict(),
    })
    .strict()

/** 账号滚动安全上限只向浏览器暴露状态和恢复时刻，绝不暴露 Token 数。 */
export const analysisRollingUsageSchema = z
    .object({
        exhausted: z.boolean(),
        retryAt: z.string().datetime({ offset: true }).nullable(),
        retryAfterSeconds: z.number().int().nonnegative(),
        canUpgrade: z.boolean(),
    })
    .strict()

export const analysisConversationTurnResultSchema = z
    .object({
        schemaVersion: z.literal('analysis-conversation-turn-result.v1'),
        action: z.enum([
            'ask_questions',
            'draft_ready',
            'confirm_topic_switch',
            'defer_media_analysis',
            'out_of_scope',
            'task_submitted',
        ]),
        assistantMessage: z.null(),
        questions: z.array(agentConversationQuestionSchema),
        completeDraft: analysisConversationDraftSchema,
        effectiveDraft: analysisDraftPayloadSchema,
        standardTask: standardAnalysisTaskSchema.nullable(),
        preparationId: z.string().min(1).nullable(),
        session: analysisConversationSessionIdentitySchema,
        tokenBudget: analysisConversationTokenBudgetSchema.nullable(),
        rollingUsage: analysisRollingUsageSchema,
    })
    .strict()
    .superRefine((result, context) => {
        if (result.action === 'ask_questions') {
            if (result.questions.length === 0) {
                context.addIssue({
                    code: 'custom',
                    path: ['questions'],
                    message: '询问动作缺少核心问题',
                })
            }
            result.questions.forEach((question, index) => {
                if (
                    question.field !== null &&
                    !coreConversationQuestionFields.has(question.field)
                ) {
                    context.addIssue({
                        code: 'custom',
                        path: ['questions', index, 'field'],
                        message: '只允许核心草稿问题',
                    })
                    return
                }
            })
            return
        }
        if (result.action === 'confirm_topic_switch') {
            const question = result.questions[0]
            if (result.questions.length !== 1 || question?.field !== null) {
                context.addIssue({
                    code: 'custom',
                    path: ['questions'],
                    message: '切题确认缺少新选题',
                })
            }
            return
        }
        if (result.action === 'draft_ready' && (!result.standardTask || !result.preparationId)) {
            context.addIssue({
                code: 'custom',
                path: ['standardTask'],
                message: '完整笔记缺少准备凭据',
            })
        }
        if (result.questions.length > 0) {
            context.addIssue({
                code: 'custom',
                path: ['questions'],
                message: '当前动作不能夹带问题',
            })
        }
    })

export const analysisConversationTurnDataSchema = z
    .object({ result: analysisConversationTurnResultSchema })
    .strict()

export const analysisConversationControlDataSchema = z
    .object({
        control: analysisConversationSessionIdentitySchema
            .extend({
                status: z.enum(['active', 'processing', 'finalized', 'submitted', 'cleared']),
                contentKind: z.enum(['image', 'video']).nullable(),
                leaseExpiresAt: z.string().datetime({ offset: true }).nullable(),
                tokenBudget: analysisConversationTokenBudgetSchema.nullable(),
                rollingUsage: analysisRollingUsageSchema,
            })
            .nullable(),
    })
    .strict()

export const analysisConversationClearDataSchema = z
    .object({
        cleared: z.boolean(),
        generation: z.number().int().positive(),
    })
    .strict()

export const analysisConversationPendingTurnSchema = z
    .object({
        turnId: z.string().uuid(),
        message: z.string().trim().min(1).max(analysisUiConstraints.rawTextMaxLength),
    })
    .strict()

export const analysisConversationTurnRecoveryDataSchema = z
    .object({
        turn: z.discriminatedUnion('status', [
            z.object({ turnId: z.string().uuid(), status: z.literal('processing') }).strict(),
            z
                .object({
                    turnId: z.string().uuid(),
                    status: z.literal('completed'),
                    result: analysisConversationTurnResultSchema,
                })
                .strict(),
            z.object({ turnId: z.string().uuid(), status: z.literal('failed') }).strict(),
            z
                .object({
                    turnId: z.string().uuid(),
                    status: z.literal('cancelled'),
                    reason: z.enum(['conversation_cleared', 'logged_out']),
                })
                .strict(),
            z.object({ turnId: z.string().uuid(), status: z.literal('acknowledged') }).strict(),
            z.object({ turnId: z.string().uuid(), status: z.literal('missing') }).strict(),
        ]),
    })
    .strict()

export const analysisConversationTurnAckDataSchema = z
    .object({ acknowledged: z.boolean() })
    .strict()

export type AnalysisConversationDraft = z.infer<typeof analysisConversationDraftSchema>
export type AnalysisConversationMessage = z.infer<typeof analysisConversationMessageSchema>
export type AnalysisConversationTurnResult = z.infer<typeof analysisConversationTurnResultSchema>
export type AgentConversationQuestion = z.infer<typeof agentConversationQuestionSchema>
export type AgentConversationAction = AnalysisConversationTurnResult['action']
export type AnalysisConversationSessionIdentity = z.infer<
    typeof analysisConversationSessionIdentitySchema
>
export type AnalysisConversationTokenBudget = z.infer<typeof analysisConversationTokenBudgetSchema>
export type AnalysisRollingUsage = z.infer<typeof analysisRollingUsageSchema>
export type AnalysisConversationControl = z.infer<
    typeof analysisConversationControlDataSchema
>['control']
export type AnalysisConversationPendingTurn = z.infer<typeof analysisConversationPendingTurnSchema>
export type AnalysisConversationTurnRecovery = z.infer<
    typeof analysisConversationTurnRecoveryDataSchema
>['turn']

export interface AnalysisConversationState {
    history: AnalysisConversationMessage[]
    completeDraft: AnalysisConversationDraft
    standardTask: StandardAnalysisTask | null
    preparationId: string | null
    tokenBudget: AnalysisConversationTokenBudget | null
    rollingUsage: AnalysisRollingUsage | null
}

function normalizedFieldValue(value: unknown) {
    if (typeof value === 'string') return value.trim() || undefined
    if (Array.isArray(value)) {
        const items = value.map((item) => String(item).trim()).filter(Boolean)
        return items.length > 0 ? items : undefined
    }
    return undefined
}

/**
 * 用后端版本化配置把首轮稀疏共享草稿补成完整草稿；后续轮次保留上轮来源，
 * 只有当前共享草稿中的显式值能够覆盖为 user_input。
 */
export function materializeConversationDraft(
    config: AnalysisTaskConfig,
    draft: AnalysisDraftPayload,
    previous?: AnalysisConversationDraft | null,
): AnalysisConversationDraft {
    const definitions = new Map(config.fields.map((field) => [field.name, field]))
    const track = normalizedFieldValue(draft.fields.track) ?? previous?.fields.track.value
    const trackDefaults = typeof track === 'string' ? (config.trackDefaults[track] ?? {}) : {}
    const entries = taskFieldNameSchema.options.map((name) => {
        const explicit = normalizedFieldValue(draft.fields[name])
        if (explicit !== undefined) {
            return [name, { value: explicit, source: 'user_input' as const }]
        }
        const prior = previous?.fields[name]
        if (prior) return [name, prior]
        const trackDefault = normalizedFieldValue(trackDefaults[name])
        if (trackDefault !== undefined) {
            return [name, { value: trackDefault, source: 'track_default' as const }]
        }
        const definition = definitions.get(name)
        if (!definition) {
            throw new Error(`任务配置缺少字段：${name}`)
        }
        return [
            name,
            {
                value: Array.isArray(definition.defaultValue)
                    ? [...definition.defaultValue]
                    : definition.defaultValue,
                source: 'system_default' as const,
            },
        ]
    })
    return analysisConversationDraftSchema.parse({
        schemaVersion: 'analysis-conversation-draft.v1',
        rawText: draft.rawText || previous?.rawText || '',
        fields: Object.fromEntries(entries),
    })
}

interface CommitConversationTurnInput {
    messageId: string
    message: string
    result: unknown
    questionId: () => string
}

/**
 * 先校验整包，再创建全新的状态对象；解析失败时调用者持有的浏览器状态绝不被部分修改。
 */
export function commitConversationTurn(
    current: AnalysisConversationState,
    input: CommitConversationTurnInput,
): AnalysisConversationState {
    const result = analysisConversationTurnResultSchema.parse(input.result)
    const userMessage = analysisConversationMessageSchema.parse({
        id: input.messageId,
        role: 'user',
        text: input.message,
    })
    const semanticQuestions = result.questions.map((question) =>
        analysisConversationMessageSchema.parse({
            id: input.questionId(),
            role:
                result.action === 'confirm_topic_switch' ? 'agent_topic_switch' : 'agent_question',
            text: question.text,
        }),
    )
    return {
        history: [...current.history, userMessage, ...semanticQuestions],
        completeDraft: result.completeDraft,
        standardTask: result.standardTask,
        preparationId: result.preparationId,
        tokenBudget: result.tokenBudget,
        rollingUsage: result.rollingUsage,
    }
}

const conversationTurnRequestSchema = z
    .object({
        schemaVersion: z.literal('analysis-conversation-turn-request.v1'),
        session: analysisConversationSessionIdentitySchema.extend({
            requestId: z.string().uuid(),
        }),
        history: z.array(analysisConversationMessageSchema),
        message: z.string().trim().min(1),
        draft: analysisDraftPayloadSchema,
        completeDraft: analysisConversationDraftSchema,
        contentKind: z.enum(['image', 'video']),
        media: z
            .object({
                images: z.array(
                    z
                        .object({
                            reference: z.string().uuid(),
                            mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
                            byteSize: z.number().int().positive(),
                        })
                        .strict(),
                ),
                video: z
                    .object({
                        reference: z.string().uuid(),
                        mediaType: z.enum(['video/mp4', 'video/quicktime']),
                        byteSize: z.number().int().positive(),
                    })
                    .strict()
                    .nullable(),
            })
            .strict(),
    })
    .strict()

export type AnalysisConversationTurnRequest = z.infer<typeof conversationTurnRequestSchema>

interface CreateConversationTurnRequestInput {
    session: AnalysisConversationTurnRequest['session']
    state: AnalysisConversationState
    message: string
    draft: AnalysisDraftPayload
    contentKind: AnalysisContentKind
    media: AnalysisConversationTurnRequest['media']
}

/** 只从语义状态组装请求；展示用问候、承接语和打字动画没有入口进入该结构。 */
export function createConversationTurnRequest(
    input: CreateConversationTurnRequestInput,
): AnalysisConversationTurnRequest {
    return conversationTurnRequestSchema.parse({
        schemaVersion: 'analysis-conversation-turn-request.v1',
        session: input.session,
        history: input.state.history,
        message: input.message,
        draft: input.draft,
        completeDraft: input.state.completeDraft,
        contentKind: input.contentKind,
        media: input.media,
    })
}

/** 从服务端标准任务响应创建浏览器语义状态。 */
export function createConversationState(
    completeDraft: AnalysisConversationDraft,
): AnalysisConversationState {
    return {
        history: [],
        completeDraft,
        standardTask: null,
        preparationId: null,
        tokenBudget: null,
        rollingUsage: null,
    }
}

/** 供工作台在原子提交后把服务端草稿映射回现有共享草稿结构。 */
export function resolvedValues(fields: AnalysisConversationDraft['fields']) {
    return Object.fromEntries(
        Object.entries(fields)
            .filter(([, field]) => field.value !== null)
            .map(([name, field]) => [name, field.value]),
    ) as AnalysisDraftPayload['fields']
}
