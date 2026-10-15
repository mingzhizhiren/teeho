import {
    contentAdvicePayloadSchema,
    CONTENT_ADVICE_LIMITS,
    adviceSourceIdPattern,
    type ContentAdvice,
    type ContentLocation,
} from './analysis.content-analysis'
import { AgentContractError, type AgentResultGenerationInput } from '../providers/analysis.provider'

/** 只为本次已准备的原文和聚合素材建立引用目录；素材身份不进入公开建议。 */
export interface AdviceEvidenceSource {
    readonly id: string
    readonly location: ContentLocation
    readonly text: string
    readonly assetReferences: readonly string[]
}

/** 建议错误只携带低基数原因，核心评价由调用方独立保留。 */
export class ContentAdviceValidationError extends AgentContractError {
    constructor(readonly reason: 'shape' | 'source' | 'quote') {
        super('Invalid content advice', { ruleId: `content.advice.${reason}` })
    }
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const

/** 模型输出结构严格声明建议；局部容错仅由独立运行时校验承担。 */
export const contentAdviceJsonSchema: Record<string, unknown> = {
    anyOf: [
        {
            type: 'object',
            additionalProperties: false,
            required: ['evidenceAvailability', 'items'],
            properties: {
                evidenceAvailability: { type: 'string', enum: ['sufficient', 'limited'] },
                items: {
                    type: 'array',
                    maxItems: CONTENT_ADVICE_LIMITS.items,
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: [
                            'priority',
                            'location',
                            'sourceId',
                            'evidence',
                            'problem',
                            'suggestion',
                        ],
                        properties: {
                            priority: { type: 'string', enum: ['high', 'medium', 'low'] },
                            location: {
                                type: 'string',
                                enum: ['title', 'body', 'topics', 'cover', 'content'],
                            },
                            sourceId: {
                                type: 'string',
                                maxLength: CONTENT_ADVICE_LIMITS.sourceId,
                                pattern: adviceSourceIdPattern.source,
                            },
                            evidence: {
                                type: 'string',
                                minLength: 1,
                                maxLength: CONTENT_ADVICE_LIMITS.evidence,
                            },
                            problem: {
                                type: 'string',
                                minLength: 1,
                                maxLength: CONTENT_ADVICE_LIMITS.problem,
                            },
                            suggestion: {
                                type: 'string',
                                minLength: 1,
                                maxLength: CONTENT_ADVICE_LIMITS.suggestion,
                            },
                        },
                    },
                },
            },
        },
        { type: 'null' },
    ],
}

function source(
    id: string,
    location: ContentLocation,
    text: string,
    assetReferences: readonly string[] = [],
): AdviceEvidenceSource[] {
    return text.trim() ? [{ id, location, text, assetReferences }] : []
}

/** 正文按非空行编号，与结构计数口径一致；不把聚合素材描述伪装成逐图事实。 */
export function createAdviceEvidenceSources(
    input: Pick<AgentResultGenerationInput, 'task' | 'materialDescriptions'>,
): AdviceEvidenceSource[] {
    const { task, materialDescriptions } = input
    const paragraphs = task.fields.body.value.split(/\r?\n/).filter((text) => text.trim())
    const videoAssetId = task.videoEvidence?.assetId
    const contentAssets = videoAssetId
        ? [videoAssetId]
        : task.imageReferences.filter((reference) => reference !== task.coverReference)
    return [
        ...source('title', 'title', task.fields.title.value),
        ...paragraphs.flatMap((text, index) => source(`body:p${index + 1}`, 'body', text)),
        ...task.fields.topics.value.flatMap((text, index) =>
            source(`topic:${index + 1}`, 'topics', text),
        ),
        ...source(
            'material:cover',
            'cover',
            materialDescriptions?.cover ?? '',
            task.coverReference ? [task.coverReference] : videoAssetId ? [videoAssetId] : [],
        ),
        ...source(
            'material:content',
            'content',
            materialDescriptions?.content ?? '',
            contentAssets,
        ),
    ]
}

/** 只读取建议字段；历史记录缺项与本次生成缺项由各自调用边界区分。 */
export function advicePayload(raw: unknown): unknown {
    return typeof raw === 'object' && raw !== null && 'advice' in raw ? raw.advice : undefined
}

/** 对建议原子校验来源和精确引用，并稳定按优先级排列。 */
export function readContentAdvice(input: AgentResultGenerationInput, raw: unknown): ContentAdvice {
    const parsed = contentAdvicePayloadSchema.safeParse(raw)
    if (!parsed.success) throw new ContentAdviceValidationError('shape')
    const sources = input.adviceSources ?? createAdviceEvidenceSources(input)
    const byId = new Map(sources.map((item) => [item.id, item]))
    for (const item of parsed.data.items) {
        const evidence = byId.get(item.sourceId)
        if (!evidence || evidence.location !== item.location) {
            throw new ContentAdviceValidationError('source')
        }
        if (!evidence.text.includes(item.evidence)) throw new ContentAdviceValidationError('quote')
    }
    return {
        status: 'completed',
        ...parsed.data,
        items: [...parsed.data.items].sort(
            (left, right) => PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority],
        ),
    }
}

/** 技术或契约失败必须显式降级，不伪装成成功空结果。 */
export function unavailableContentAdvice(): ContentAdvice {
    return { status: 'unavailable', items: [] }
}
