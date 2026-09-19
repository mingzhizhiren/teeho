import { analysisInputConstraints } from '../analysis.constants'
import {
    checkupAgentResultSchema,
    checkupMetricNames,
    checkupOutputConstraints,
} from '../checkup/analysis.checkup.contract'
import { checkupTopicConstraints } from '../checkup/analysis.checkup.topics'
import { comparisonExplanationPrompt } from '../checkup/analysis.comparison-explanation'
import { findGeneratedResultQualityViolations } from '../checkup/analysis.result-quality'
import { agentPromptCatalog } from './analysis.prompt.constants'
import {
    type AgentConversationTurnInput,
    type AgentOutputRepairInput,
    type AgentResultGenerationInput,
} from './analysis.provider'
import {
    createConversationTurnProviderDto,
    createResultGenerationProviderDto,
} from './analysis.provider-dto'

type JsonSchema = Record<string, unknown>

const conversationPatchFields = ['title', 'body', 'topics'] as const
const conversationQuestionIdMaxLength = 80

function conversationPatchSetVariant(field: string, value: JsonSchema): JsonSchema {
    return {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'operation', 'value', 'source'],
        properties: {
            field: { type: 'string', enum: [field] },
            operation: { type: 'string', enum: ['set'] },
            value,
            source: { type: 'string', enum: ['user_input'] },
        },
    }
}

const conversationPatchVariants: JsonSchema[] = [
    conversationPatchSetVariant('title', {
        type: 'string',
        minLength: 1,
        maxLength: analysisInputConstraints.fields.titleMaxLength,
    }),
    conversationPatchSetVariant('body', {
        type: 'string',
        minLength: 1,
        maxLength: analysisInputConstraints.fields.bodyMaxLength,
    }),
    conversationPatchSetVariant('topics', {
        type: 'array',
        minItems: 1,
        maxItems: analysisInputConstraints.fields.topicsMaxItems,
        items: {
            type: 'string',
            minLength: 1,
            maxLength: analysisInputConstraints.fields.topicItemMaxLength,
        },
    }),
    {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'operation', 'value', 'source'],
        properties: {
            field: { type: 'string', enum: [...conversationPatchFields] },
            operation: { type: 'string', enum: ['clear'] },
            value: { type: 'null' },
            source: { type: 'null' },
        },
    },
]

/** 与受控草稿补丁一致的模型传输契约；问题不允许携带代写建议。 */
export const conversationTurnJsonSchema: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['action', 'assistantMessage', 'questions', 'draftPatch'],
    properties: {
        action: {
            type: 'string',
            enum: [
                'ask_questions',
                'draft_ready',
                'defer_media_analysis',
                'out_of_scope',
                'task_submitted',
            ],
        },
        assistantMessage: { type: 'null' },
        questions: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'field', 'text', 'suggestedValue'],
                properties: {
                    id: {
                        type: 'string',
                        minLength: 1,
                        maxLength: conversationQuestionIdMaxLength,
                    },
                    field: { type: ['string', 'null'], enum: [...conversationPatchFields, null] },
                    text: {
                        type: 'string',
                        minLength: 1,
                        maxLength: analysisInputConstraints.clarification.questionMaxLength,
                    },
                    suggestedValue: { type: 'null' },
                },
            },
        },
        draftPatch: {
            type: 'array',
            maxItems: conversationPatchFields.length,
            items: { anyOf: conversationPatchVariants },
        },
    },
}

const metricEvaluationItem: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['score', 'reason'],
    properties: {
        score: {
            type: 'number',
            minimum: 0,
            maximum: checkupOutputConstraints.maximumScore,
            description:
                'Independent 0-100 Agent content review, rounded to two decimal places. Missing external evidence does not imply poor content.',
        },
        reason: {
            type: 'string',
            minLength: 1,
            maxLength: checkupOutputConstraints.itemMaxLength,
        },
    },
}

/** Codex CLI 使用的唯一结果 JSON Schema；业务层仍会再经过 Zod 严格校验。 */
export const generateResultJsonSchema: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'agentMetricEvaluations',
        'matchedTopicIds',
        'coverDescription',
        'summary',
        'strengths',
        'risks',
        'uncertainties',
    ],
    properties: {
        matchedTopicIds: {
            type: 'array',
            maxItems: checkupTopicConstraints.matchLimit,
            items: { type: 'string', minLength: 1, maxLength: checkupTopicConstraints.idMaxLength },
        },
        coverDescription: {
            type: ['string', 'null'],
            maxLength: checkupOutputConstraints.summaryMaxLength,
            description:
                'Describe visible cover content, text and layout objectively. Null if no cover. Do not include scores or inferred popularity.',
        },
        agentMetricEvaluations: {
            type: 'object',
            additionalProperties: false,
            required: [...checkupMetricNames],
            properties: Object.fromEntries(
                checkupMetricNames.map((name) => [name, metricEvaluationItem]),
            ),
        },
        summary: {
            type: 'string',
            minLength: 1,
            maxLength: checkupOutputConstraints.summaryMaxLength,
        },
        strengths: {
            type: 'array',
            maxItems: checkupOutputConstraints.maxStrengths,
            items: {
                type: 'string',
                minLength: 1,
                maxLength: checkupOutputConstraints.itemMaxLength,
            },
        },
        uncertainties: {
            type: 'array',
            maxItems: checkupOutputConstraints.maxUncertainties,
            items: {
                type: 'string',
                minLength: 1,
                maxLength: checkupOutputConstraints.itemMaxLength,
            },
        },
        risks: {
            type: 'array',
            maxItems: checkupOutputConstraints.maxRisks,
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['severity', 'message', 'suggestion', 'location'],
                properties: {
                    severity: { type: 'string', enum: ['priority', 'notice'] },
                    message: {
                        type: 'string',
                        minLength: 1,
                        maxLength: checkupOutputConstraints.itemMaxLength,
                    },
                    suggestion: {
                        type: 'string',
                        maxLength: checkupOutputConstraints.itemMaxLength,
                    },
                    location: {
                        anyOf: [
                            {
                                type: 'object',
                                additionalProperties: false,
                                required: ['kind', 'quote'],
                                properties: {
                                    kind: { type: 'string', enum: ['title', 'body', 'topics'] },
                                    quote: {
                                        type: 'string',
                                        maxLength: checkupOutputConstraints.itemMaxLength,
                                    },
                                },
                            },
                            {
                                type: 'object',
                                additionalProperties: false,
                                required: ['kind', 'imageIndex'],
                                properties: {
                                    kind: { type: 'string', enum: ['image'] },
                                    imageIndex: { type: 'integer', minimum: 0 },
                                },
                            },
                            {
                                type: 'object',
                                additionalProperties: false,
                                required: ['kind'],
                                properties: {
                                    kind: { type: 'string', enum: ['cover'] },
                                },
                            },
                            {
                                type: 'object',
                                additionalProperties: false,
                                required: ['kind', 'timestampMs'],
                                properties: {
                                    kind: { type: 'string', enum: ['video'] },
                                    timestampMs: { type: 'integer', minimum: 0 },
                                },
                            },
                        ],
                    },
                },
            },
        },
    },
}

interface RepairSchemaTree {
    [key: string]: RepairSchemaTree | true
}

function repairSchemaTree(paths: string[]): RepairSchemaTree {
    const root: RepairSchemaTree = {}
    for (const path of paths) {
        const segments = path.split('.').filter(Boolean)
        let current = root
        segments.forEach((segment, index) => {
            if (index === segments.length - 1) {
                current[segment] = true
                return
            }
            const existing = current[segment]
            if (!existing || existing === true) {
                current[segment] = {}
            }
            current = current[segment] as RepairSchemaTree
        })
    }
    return root
}

function selectRepairSchema(schema: JsonSchema, tree: RepairSchemaTree | true): JsonSchema {
    if (tree === true) return schema
    const properties = schema.properties as Record<string, JsonSchema> | undefined
    const selected = Object.fromEntries(
        Object.entries(tree).flatMap(([key, child]) => {
            const property = properties?.[key]
            return property ? [[key, selectRepairSchema(property, child)] as const] : []
        }),
    )
    return {
        type: 'object',
        additionalProperties: false,
        required: Object.keys(selected),
        properties: selected,
    }
}

function repairPatchEnvelopeSchema(repairPatch: JsonSchema): JsonSchema {
    return {
        type: 'object',
        additionalProperties: false,
        required: ['repairPatch'],
        properties: { repairPatch },
    }
}

/** 为一次字段修复生成只允许错误路径的 JSON Schema。 */
export function createRepairResultJsonSchema(input: AgentOutputRepairInput): JsonSchema {
    const repairPatch =
        input.mode === 'full'
            ? generateResultJsonSchema
            : selectRepairSchema(generateResultJsonSchema, repairSchemaTree(input.fieldPaths))
    return repairPatchEnvelopeSchema(repairPatch)
}

/** 按版本化契约组装 Agent 系统提示词和输入 */
function createAgentPrompt(systemPrompt: string, instructions: string, payload: unknown) {
    return [systemPrompt, instructions, JSON.stringify(payload)].join('\n\n')
}

function valueAtPath(value: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((current, segment) => {
        if (typeof current !== 'object' || current === null || Array.isArray(current)) {
            return undefined
        }
        return (current as Record<string, unknown>)[segment]
    }, value)
}

function selectRepairOutputValues(value: unknown, fieldPaths: readonly string[]) {
    return Object.fromEntries(
        fieldPaths.flatMap((path) => {
            const currentValue = valueAtPath(value, path)
            return currentValue === undefined ? [] : [[path, currentValue]]
        }),
    )
}

function schemaAtPath(schema: JsonSchema, path: string): JsonSchema | undefined {
    return path.split('.').reduce<JsonSchema | undefined>((current, segment) => {
        if (!current) return undefined
        const properties = current.properties as Record<string, JsonSchema> | undefined
        return properties?.[segment]
    }, schema)
}

function selectRepairFieldConstraints(
    schema: JsonSchema,
    fieldPaths: readonly string[],
): Record<string, JsonSchema> {
    return Object.fromEntries(
        fieldPaths.flatMap((path) => {
            const constraint = schemaAtPath(schema, path)
            return constraint ? [[path, constraint]] : []
        }),
    )
}

const repairNeighborPaths: Readonly<Record<string, readonly string[]>> = Object.freeze({
    summary: ['strengths'],
    strengths: ['summary'],
    risks: [],
    uncertainties: [],
})

function neighboringPaths(path: string): readonly string[] {
    const configured = repairNeighborPaths[path]
    if (configured) return configured
    if (!path.startsWith('agentMetricEvaluations.')) return []
    if (path.endsWith('.score')) return [path.replace(/\.score$/u, '.reason')]
    if (path.endsWith('.reason')) return [path.replace(/\.reason$/u, '.score')]
    return []
}

function selectRepairNeighborValues(
    value: unknown,
    fieldPaths: readonly string[],
): Record<string, unknown> {
    const paths = [...new Set(fieldPaths.flatMap((path) => neighboringPaths(path)))]
    return selectRepairOutputValues(value, paths)
}

/** 生成真实多轮任务形成提示；预设文案和素材身份从来不属于 Provider 上下文。 */
export function createConversationTurnPrompt(input: AgentConversationTurnInput) {
    return createAgentPrompt(
        agentPromptCatalog.formConversationTurn.systemPrompt,
        agentPromptCatalog.formConversationTurn.instructions,
        createConversationTurnProviderDto(input),
    )
}

/** 生成仅评审已有笔记的结果提示。 */
export function createGenerateResultPrompt(input: AgentResultGenerationInput) {
    if (input.comparisonFacts) return comparisonExplanationPrompt(input)
    return createAgentPrompt(
        agentPromptCatalog.generateResult.systemPrompt,
        agentPromptCatalog.generateResult.instructions,
        createResultGenerationProviderDto(input),
    )
}

/** 生成只处理首次校验问题、禁止重新分析的修复提示。 */
export function createRepairResultPrompt(input: AgentOutputRepairInput) {
    const resultContext = createResultGenerationProviderDto(input.generationInput)
    // 规则编号不包含修复语义；提供逐项原因，避免模型原样保留违规句子。
    const original = checkupAgentResultSchema.safeParse(input.originalOutput)
    const qualityViolations = original.success
        ? findGeneratedResultQualityViolations(original.data, input.generationInput)
        : []
    const locationEvidence = input.fieldPaths.some(
        (path) => path === 'risks' || path.startsWith('risks.'),
    )
        ? {
              title: input.generationInput.task.fields.title.value,
              body: input.generationInput.task.fields.body.value,
              topics: input.generationInput.task.fields.topics.value,
              contentKind: input.generationInput.task.contentKind,
              noteImageCount: resultContext.media.noteImageCount,
              coverImageIndex: resultContext.task.coverImageIndex,
              images: resultContext.media.images ?? [],
              videoDurationMs: input.generationInput.videoEvidence?.durationMs ?? null,
          }
        : undefined
    const instructions =
        input.mode === 'full'
            ? agentPromptCatalog.repairResult.instructions.full
            : agentPromptCatalog.repairResult.instructions.fields
    return createAgentPrompt(
        agentPromptCatalog.repairResult.systemPrompt,
        instructions,
        input.mode === 'full'
            ? {
                  mode: input.mode,
                  targetContract: 'analysis-result-provider.v6',
                  validationError: {
                      rule: input.ruleId,
                      fieldPaths: input.fieldPaths,
                      ...(qualityViolations.length > 0 ? { qualityViolations } : {}),
                  },
                  outputLanguage: resultContext.outputLanguage,
                  originalOutput: input.originalOutput,
              }
            : {
                  mode: input.mode,
                  fieldPaths: input.fieldPaths,
                  validationRule: input.ruleId,
                  ...(qualityViolations.length > 0 ? { qualityViolations } : {}),
                  fieldConstraints: selectRepairFieldConstraints(
                      generateResultJsonSchema,
                      input.fieldPaths,
                  ),
                  outputLanguage: resultContext.outputLanguage,
                  currentValues: selectRepairOutputValues(input.originalOutput, input.fieldPaths),
                  neighborValues: selectRepairNeighborValues(
                      input.originalOutput,
                      input.fieldPaths,
                  ),
                  ...(locationEvidence ? { locationEvidence } : {}),
              },
    )
}
