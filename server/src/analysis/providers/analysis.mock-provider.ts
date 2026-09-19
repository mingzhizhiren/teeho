import { inferNoteIntent } from '../tracks/analysis.intent'
import { createAgentOutputRepairPatch } from './analysis.agent-output-repair'
import { agentPromptCatalog } from './analysis.prompt.constants'
import {
    AgentProviderError,
    agentGeneratedResultSchema,
    validateAgentVideoEvidenceForProvider,
    type AgentConversationTurnInput,
    type AgentOutputRepairInput,
    type AgentProvider,
    type AgentResultGenerationInput,
} from './analysis.provider'

const noteFieldLabels = {
    title: '标题|title',
    body: '正文|body|caption',
    topics: '话题|标签|topics?|tags?|hashtags?',
} as const
const allNoteFieldLabels = Object.values(noteFieldLabels).join('|')

function labeledNoteValue(text: string, field: keyof typeof noteFieldLabels): string | null {
    const pattern = new RegExp(
        '(?:^|\\n)\\s*(?:' +
            noteFieldLabels[field] +
            ')\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*(?:' +
            allNoteFieldLabels +
            ')\\s*[:：]|$)',
        'iu',
    )
    return text.match(pattern)?.[1]?.trim() || null
}

function extractNoteFields(text: string): {
    title: string | null
    body: string | null
    topics: string[] | null
} {
    const topics = labeledNoteValue(text, 'topics')
    return {
        title: labeledNoteValue(text, 'title'),
        body: labeledNoteValue(text, 'body'),
        topics: topics ? topics.split(/[\s,，、]+/u).filter(Boolean) : null,
    }
}

/** 确定性 Mock Provider；不调用外部模型或自主工具 */
export class MockAgentProvider implements AgentProvider {
    async understandMaterial(
        input: import('../materials/analysis.material').MaterialUnderstandingInput,
    ): Promise<unknown> {
        return input.kind === 'classification'
            ? {
                  primaryTrack: 1,
                  intent: inferNoteIntent(
                      input.task.fields.title.value,
                      input.task.fields.body.value,
                  ),
              }
            : { description: '合成素材包含清楚可见的主体，供任务链路验证。' }
    }
    async formConversationTurn(input: AgentConversationTurnInput): Promise<unknown> {
        const isCreationRequest =
            /(?:帮我|替我).{0,4}(?:写|创作|生成|优化|改写)|\b(?:write|generate|rewrite|optimize)\b/iu.test(
                input.message,
            )
        if (isCreationRequest)
            return { action: 'out_of_scope', assistantMessage: null, questions: [], draftPatch: [] }
        const extracted = extractNoteFields(input.message)
        const lastQuestion = input.history.at(-1)
        const answeringField =
            lastQuestion?.role === 'agent_question'
                ? (Object.keys(noteFieldLabels) as Array<keyof typeof noteFieldLabels>).find(
                      (name) => new RegExp(noteFieldLabels[name], 'iu').test(lastQuestion.text),
                  )
                : undefined
        const fields =
            answeringField && !Object.values(extracted).some(Boolean)
                ? {
                      ...extracted,
                      [answeringField]:
                          answeringField === 'topics'
                              ? input.message.split(/[\s,，、]+/u).filter(Boolean)
                              : input.message,
                  }
                : extracted
        return {
            action: 'draft_ready',
            assistantMessage: null,
            questions: [],
            draftPatch: Object.entries(fields).flatMap(([field, value]) =>
                value === null ? [] : [{ field, operation: 'set', value, source: 'user_input' }],
            ),
        }
    }

    /**
     * 以确定性规则生成用于开发和测试的分析结果。
     * @param input 已解析任务、证据及取消信号
     */
    async generateResult(input: AgentResultGenerationInput): Promise<unknown> {
        validateAgentVideoEvidenceForProvider(input.videoEvidence, input.images, 'codex')
        void agentPromptCatalog.generateResult
        if (input.task.fields.title.value === 'TEEHO_ACCEPTANCE_FORCE_FAILURE') {
            throw new AgentProviderError('capability', {
                message: 'Deterministic acceptance failure',
                retryable: false,
            })
        }
        if (input.comparisonFacts) {
            return {
                consistency: {
                    stars: 4,
                    summary: '模拟内容一致性分析，仅用于验证流程。',
                    issues: [],
                },
                weaknesses: [],
                matchedTopicIds: [],
                dismissedRiskIds: [],
            }
        }
        return agentGeneratedResultSchema.parse({
            agentMetricEvaluations: {
                topicDemand: { score: 60, reason: '示例评审：笔记具有具体主题。' },
                titleCoverExpression: { score: 60, reason: '示例评审：已提供标题与素材。' },
                contentFulfillment: { score: 60, reason: '示例评审：正文包含可检查的信息。' },
                readingExperience: { score: 60, reason: '示例评审：素材可用于阅读体验检查。' },
                interactionValue: { score: 60, reason: '示例评审：内容可讨论其收藏与交流价值。' },
                differentiationTiming: {
                    score: 60,
                    reason: '示例评审：差异与时效需结合实际证据。',
                },
            },
            summary: '模拟体检用于验证报告与任务流程，不代表真实内容效果。',
            matchedTopicIds: [],
            strengths: ['已提供待评审的笔记内容'],
            risks: [],
            uncertainties: ['模拟评审不预测平台流量。'],
        })
    }

    /** 为测试环境确定性执行一次受限输出修复。 */
    async repairResult(input: AgentOutputRepairInput): Promise<unknown> {
        const generated = agentGeneratedResultSchema.parse(
            await this.generateResult(input.generationInput),
        )
        return {
            repairPatch:
                input.mode === 'full'
                    ? generated
                    : createAgentOutputRepairPatch(generated, input.fieldPaths),
        }
    }
}
