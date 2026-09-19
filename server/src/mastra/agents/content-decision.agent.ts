import { Agent } from '@mastra/core/agent'
import type { OpenAICompatibleConfig } from '@mastra/core/llm'

import { agentPromptCatalog } from '../../analysis/providers/analysis.prompt.constants'

export interface ContentDecisionAgentConfig {
    provider: 'openai' | 'gemini'
    model: string
    apiKey: string
}

/** 创建没有工具、记忆、存储或工作区能力的内容决策 Agent。 */
export function createContentDecisionAgent(config: ContentDecisionAgentConfig) {
    const providerId = config.provider === 'gemini' ? 'google' : 'openai'
    const model = {
        id: `${providerId}/${config.model}`,
        apiKey: config.apiKey,
    } satisfies OpenAICompatibleConfig

    return new Agent({
        id: 'teeho-content-decision',
        name: '题火内容决策',
        instructions: agentPromptCatalog.generateResult.systemPrompt,
        model,
        tools: {},
        defaultOptions: {
            activeTools: [],
            toolChoice: 'none',
            maxSteps: 1,
            modelSettings: {
                maxRetries: 0,
            },
            disableBackgroundTasks: true,
        },
    })
}
