import { analysisConversationConstraints } from '../analysis.constants'
import type {
    AnalysisConversationDraft,
    AnalysisConversationMessage,
} from './analysis.conversation.contract'

const estimatedCharactersPerToken = 4
const minimumComparableFactLength = 2
const representedFactWrapperMaxLength = 12

const explicitCorrectionPattern =
    /纠正|更正|改为|不是|取消|删除|清空|\b(?:correction|change to|remove|clear)\b/iu
const explicitCorrectionOrConstraintPattern =
    /纠正|更正|改为|不是|取消|删除|清空|必须|不得|不要|禁止|只能|务必|\b(?:correction|change to|remove|clear|must|never|do not|don't)\b/iu
const userFactPattern =
    /标题|正文|话题|标签|我是|我的|要求|需要|\b(?:title|body|caption|topics?|hashtags?|i am|i'm|my|need|only)\b/iu
const presentationReplyPattern =
    /^(?:收到|好的|明白|已记录|已处理|我已|got it\b|noted\b|updated\b)/iu
const correctionFieldPatterns = [
    /预算|\bbudget\b/iu,
    /标题|\btitle\b/iu,
    /正文|文案|\bbody\b|\bcaption\b/iu,
    /话题|标签|\btopics?\b|\btags?\b/iu,
    /受众|人群|\baudience\b/iu,
    /语气|\btone\b/iu,
    /账号定位|\baccount positioning\b/iu,
    /品牌|\bbrand\b/iu,
    /选题|主题|\btopic\b/iu,
]

export interface ConversationProviderInputShape {
    readonly history: readonly AnalysisConversationMessage[]
    readonly message: string
    readonly completeDraft: AnalysisConversationDraft
}

export interface CompactedConversationHistory {
    readonly history: readonly AnalysisConversationMessage[]
    readonly aggressive: boolean
    readonly estimatedInputTokens: number
}

interface HistoryCandidate {
    readonly index: number
    readonly message: AnalysisConversationMessage
    readonly reason: 'protected' | 'pending' | 'topic_context'
}

function normalizeSemanticText(value: string): string {
    return value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[\p{P}\p{S}\s]+/gu, '')
}

function structuredDraftFacts(draft: AnalysisConversationDraft): readonly string[] {
    return [
        draft.rawText,
        ...Object.values(draft.fields).flatMap((field) =>
            Array.isArray(field.value) ? field.value : [field.value ?? ''],
        ),
    ]
        .map((value) => normalizeSemanticText(String(value)))
        .filter((value) => value.length >= minimumComparableFactLength)
}

function isRepresentedByDraft(text: string, facts: readonly string[]): boolean {
    const normalized = normalizeSemanticText(text)
    return facts.some(
        (fact) =>
            fact.includes(normalized) ||
            (normalized.includes(fact) &&
                normalized.length <= fact.length + representedFactWrapperMaxLength),
    )
}

function latestUserIndex(history: readonly AnalysisConversationMessage[]): number {
    return history.reduce((latest, item, index) => (item.role === 'user' ? index : latest), -1)
}

/** 估算真正序列化给任务形成 Provider 的文本输入量。 */
export function estimateConversationProviderInputTokens(
    input: ConversationProviderInputShape,
): number {
    return Math.max(1, Math.ceil(JSON.stringify(input).length / estimatedCharactersPerToken))
}

function semanticCandidates(input: ConversationProviderInputShape): readonly HistoryCandidate[] {
    const facts = structuredDraftFacts(input.completeDraft)
    const currentTopic = normalizeSemanticText(String(input.completeDraft.fields.title.value ?? ''))
    const lastUser = latestUserIndex(input.history)
    const latestCorrection = input.history.reduce(
        (latest, item, index) =>
            item.role === 'user' && explicitCorrectionPattern.test(item.text) ? index : latest,
        -1,
    )
    const latestCorrectionText =
        latestCorrection >= 0 ? (input.history[latestCorrection]?.text ?? '') : ''
    const latestSubstantiveReply = input.history.reduce((latest, item, index) => {
        if (
            item.role !== 'agent_reply' ||
            index < latestCorrection ||
            presentationReplyPattern.test(item.text) ||
            isRepresentedByDraft(item.text, facts)
        ) {
            return latest
        }
        const normalized = normalizeSemanticText(item.text)
        return currentTopic && normalized.includes(currentTopic) ? index : latest
    }, -1)

    return input.history.flatMap((item, index): readonly HistoryCandidate[] => {
        if (item.role === 'agent_question' && index > lastUser) {
            return [{ index, message: { ...item }, reason: 'pending' }]
        }
        if (item.role === 'agent_reply' && index === latestSubstantiveReply) {
            return [{ index, message: { ...item }, reason: 'topic_context' }]
        }
        if (item.role !== 'user') return []

        const isProtected =
            index === lastUser ||
            explicitCorrectionOrConstraintPattern.test(item.text) ||
            userFactPattern.test(item.text)
        const isRepresented = isRepresentedByDraft(item.text, facts)
        if (latestCorrection >= 0 && index < latestCorrection) {
            const sharesCorrectedField = correctionFieldPatterns.some(
                (pattern) => pattern.test(item.text) && pattern.test(latestCorrectionText),
            )
            return isProtected && !isRepresented && !sharesCorrectedField
                ? [{ index, message: { ...item }, reason: 'protected' }]
                : []
        }
        if (isProtected) {
            return [{ index, message: { ...item }, reason: 'protected' }]
        }
        if (isRepresented) return []

        const normalized = normalizeSemanticText(item.text)
        if (currentTopic && normalized.includes(currentTopic)) {
            return [{ index, message: { ...item }, reason: 'topic_context' }]
        }
        return []
    })
}

/** 按语义状态压缩 Provider 历史；超过阈值时只额外收敛已处理主题上下文。 */
export function compactConversationHistory(
    input: ConversationProviderInputShape,
): CompactedConversationHistory {
    const candidates = semanticCandidates(input)
    const semanticHistory = candidates.map((candidate) => candidate.message)
    const semanticEstimate = estimateConversationProviderInputTokens({
        ...input,
        history: semanticHistory,
    })
    const aggressive =
        semanticEstimate > analysisConversationConstraints.historyCompressionEstimatedTokenThreshold
    const latestTopicContextIndex = candidates.reduce(
        (latest, candidate) =>
            candidate.reason === 'topic_context' ? Math.max(latest, candidate.index) : latest,
        -1,
    )
    const compacted = aggressive
        ? candidates
              .filter(
                  (candidate) =>
                      candidate.reason !== 'topic_context' ||
                      candidate.index === latestTopicContextIndex,
              )
              .map((candidate) => candidate.message)
        : semanticHistory

    return {
        history: compacted,
        aggressive,
        estimatedInputTokens: estimateConversationProviderInputTokens({
            ...input,
            history: compacted,
        }),
    }
}
