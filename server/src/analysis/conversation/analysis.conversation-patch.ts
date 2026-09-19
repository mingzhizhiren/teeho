import { z } from 'zod'

import { AgentContractError } from '../providers/analysis.provider'
import {
    analysisConversationDraftPatchSchema,
    analysisConversationDraftSchema,
    type AnalysisConversationDraft,
    type AnalysisConversationDraftPatch,
    type AnalysisConversationMessage,
} from './analysis.conversation.contract'

const clearValues = {
    title: null,
    body: null,
    topics: [] as string[],
} as const

type ClearableFieldName = keyof typeof clearValues

function isClearableField(name: string): name is ClearableFieldName {
    return Object.hasOwn(clearValues, name)
}

interface ConversationGroundingInput {
    message: string
    history: readonly AnalysisConversationMessage[]
    completeDraft: AnalysisConversationDraft
}

function groundingText(value: string, isTopic: boolean): string {
    const normalized = value.normalize('NFC').replace(/\s+/gu, '')
    return isTopic ? normalized.replace(/[#＃]+/gu, '') : normalized
}

function userContentSources(input: ConversationGroundingInput): string[] {
    return [
        input.message,
        ...input.history
            .filter((message) => message.role === 'user')
            .map((message) => message.text),
        ...['title', 'body', 'topics'].flatMap((name) => {
            const field = input.completeDraft.fields[name as ClearableFieldName]
            if (field.source !== 'user_input') return []
            return Array.isArray(field.value) ? field.value : field.value ? [field.value] : []
        }),
    ]
}

function hasClearInstruction(message: string, field: string): boolean {
    if (!/(?:清空|删除|移除|去掉|clear|remove|delete)/iu.test(message)) return false
    const labels: Record<string, RegExp> = {
        title: /标题|title/iu,
        body: /正文|body|caption/iu,
        topics: /话题|标签|topics?|hashtags?/iu,
    }
    return (
        /(?:草稿|全部|所有|whole draft|everything)/iu.test(message) ||
        Boolean(labels[field]?.test(message))
    )
}

/** 模型补丁必须能追溯到用户提供的文字，不能通过伪造 source 代写。 */
export function groundConversationDraftPatch(
    input: ConversationGroundingInput,
    patch: AnalysisConversationDraftPatch,
): AnalysisConversationDraftPatch {
    const sources = userContentSources(input)
    for (const [name, operation] of Object.entries(patch)) {
        const values =
            operation.operation === 'set'
                ? Array.isArray(operation.value)
                    ? operation.value
                    : [operation.value]
                : []
        const grounded =
            operation.operation === 'clear'
                ? hasClearInstruction(input.message, name)
                : values.length > 0 &&
                  values.every((value) => {
                      const text = groundingText(value, name === 'topics')
                      return (
                          text.length > 0 &&
                          sources.some((source) =>
                              groundingText(source, name === 'topics').includes(text),
                          )
                      )
                  })
        if (!grounded) {
            throw new AgentContractError('Agent 草稿补丁没有对应的用户内容', {
                validationFieldPaths: [`draftPatch.${name}`],
                ruleId: 'form-conversation-turn.ungrounded-content',
            })
        }
    }
    return patch
}

/** 合并受控 set/clear 补丁，并重新校验完整权威草稿。 */
export function applyConversationDraftPatch(
    draft: AnalysisConversationDraft,
    rawPatch: AnalysisConversationDraftPatch,
): AnalysisConversationDraft {
    let patch: AnalysisConversationDraftPatch
    try {
        patch = analysisConversationDraftPatchSchema.parse(rawPatch)
    } catch (error) {
        const issues = error instanceof z.ZodError ? error.issues : []
        throw new AgentContractError('Agent 草稿补丁结构无效', {
            validationFieldPaths: issues.map((issue) => ['draftPatch', ...issue.path].join('.')),
            ruleId: 'form-conversation-turn.draft-patch-schema',
            cause: error,
        })
    }

    const changedFields = Object.fromEntries(
        Object.entries(patch).map(([name, operation]) => {
            if (operation.operation === 'clear') {
                if (!isClearableField(name)) {
                    throw new AgentContractError('该草稿字段不能清空', {
                        validationFieldPaths: [`draftPatch.${name}`],
                        ruleId: 'form-conversation-turn.draft-patch-clear',
                    })
                }
                const value = clearValues[name]
                return [
                    name,
                    {
                        value: Array.isArray(value) ? [...value] : value,
                        source: 'system_default',
                    },
                ]
            }
            return [
                name,
                {
                    value: Array.isArray(operation.value) ? [...operation.value] : operation.value,
                    source: operation.source,
                },
            ]
        }),
    )

    try {
        return analysisConversationDraftSchema.parse({
            ...draft,
            fields: { ...draft.fields, ...changedFields },
        })
    } catch (error) {
        const issues = error instanceof z.ZodError ? error.issues : []
        throw new AgentContractError('Agent 草稿补丁无法形成合法完整草稿', {
            validationFieldPaths: issues.map((issue) => issue.path.join('.')),
            ruleId: 'form-conversation-turn.draft-patch-merge',
            cause: error,
        })
    }
}
