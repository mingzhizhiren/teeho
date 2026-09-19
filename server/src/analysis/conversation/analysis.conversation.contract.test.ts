import { describe, expect, it } from 'vitest'

import { AgentContractError, readAgentConversationTurn } from '../providers/analysis.provider'
import { analysisDraftSchema, analysisDraftStateSchema } from '../analysis.schema'
function question(id: string, suggestedValue: string | string[] | null = null) {
    return {
        id,
        field: 'title',
        text: `请提供已有标题 ${id}`,
        suggestedValue,
    }
}

describe('controlled conversation turn contract', () => {
    it('空草稿可保存为回合状态，但不能作为空请求提交', () => {
        const draft = { inputMode: 'agent', rawText: '', imageReferences: [], fields: {} }
        expect(analysisDraftStateSchema.safeParse(draft).success).toBe(true)
        expect(analysisDraftSchema.safeParse(draft).success).toBe(false)
        expect(
            analysisDraftStateSchema.safeParse({
                ...draft,
                coverReference: '00000000-0000-4000-8000-000000000001',
            }).success,
        ).toBe(false)
    })

    it('任务形成只返回动作和必要问题，不接受 Provider 自由回复', () => {
        expect(
            readAgentConversationTurn({
                action: 'draft_ready',
                assistantMessage: null,
                questions: [],
                draftPatch: [],
            }).assistantMessage,
        ).toBeNull()
        expect(() =>
            readAgentConversationTurn({
                action: 'draft_ready',
                assistantMessage: '不应进入任务形成契约的自由回复',
                questions: [],
                draftPatch: [],
            }),
        ).toThrow(AgentContractError)
    })

    it('核心缺项问题使用空建议值，不产生草稿补丁', () => {
        const questions = Array.from({ length: 2 }, (_, index) => question(`topic-${index + 1}`))

        expect(
            readAgentConversationTurn({
                action: 'ask_questions',
                assistantMessage: null,
                questions,
                draftPatch: [],
            }).questions,
        ).toHaveLength(2)
    })

    it('拒绝非核心字段问题、锁定赛道补丁和含糊 null 操作', () => {
        expect(() =>
            readAgentConversationTurn({
                action: 'ask_questions',
                assistantMessage: null,
                questions: [
                    {
                        id: 'audience',
                        field: 'targetAudience',
                        text: '目标受众是谁？',
                        suggestedValue: '职场新人',
                    },
                ],
                draftPatch: [],
            }),
        ).toThrow(AgentContractError)
        expect(() =>
            readAgentConversationTurn({
                action: 'ask_questions',
                assistantMessage: null,
                questions: [question('generated-suggestion', '未提供的标题')],
                draftPatch: [],
            }),
        ).toThrow(AgentContractError)
        expect(() =>
            readAgentConversationTurn({
                action: 'draft_ready',
                assistantMessage: null,
                questions: [],
                draftPatch: [
                    {
                        field: 'track',
                        operation: 'set',
                        value: 'food_and_drink',
                        source: 'agent_inference',
                    },
                ],
            }),
        ).toThrow(AgentContractError)
        expect(() =>
            readAgentConversationTurn({
                action: 'draft_ready',
                assistantMessage: null,
                questions: [],
                draftPatch: [
                    {
                        field: 'title',
                        operation: 'set',
                        value: null,
                        source: null,
                    },
                ],
            }),
        ).toThrow(AgentContractError)
    })

    it('明确清空字段使用null传输，不再接受旧切题动作', () => {
        const result = readAgentConversationTurn({
            action: 'draft_ready',
            assistantMessage: null,
            questions: [],
            draftPatch: [{ field: 'title', operation: 'clear', value: null, source: null }],
        })
        expect(result.draftPatch).toEqual({ title: { operation: 'clear' } })
        expect(() =>
            readAgentConversationTurn({
                action: 'confirm_topic_switch',
                assistantMessage: null,
                questions: [],
                draftPatch: [],
            }),
        ).toThrow(AgentContractError)
    })
})
