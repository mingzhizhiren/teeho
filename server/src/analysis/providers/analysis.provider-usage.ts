import type { AgentProviderUsage } from './analysis.provider'

/** 从未知用量对象中读取非负令牌数 */
function readTokenCount(record: Record<string, unknown>, ...keys: string[]) {
    for (const key of keys) {
        const value = record[key]
        if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
            return value
        }
    }
    return null
}

/** 将不同 Provider 的 token 字段统一为题火内部用量结构 */
export function normalizeAgentProviderUsage(value: unknown): AgentProviderUsage | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return null
    }
    const usage = value as Record<string, unknown>
    const inputTokens = readTokenCount(
        usage,
        'inputTokens',
        'input_tokens',
        'promptTokens',
        'prompt_tokens',
    )
    const textInputTokens = readTokenCount(usage, 'textInputTokens', 'text_input_tokens')
    const imageInputTokens = readTokenCount(usage, 'imageInputTokens', 'image_input_tokens')
    const cachedInputTokens = readTokenCount(
        usage,
        'cachedInputTokens',
        'cached_input_tokens',
        'cacheReadInputTokens',
        'cache_read_input_tokens',
    )
    const reasoningTokens = readTokenCount(
        usage,
        'reasoningTokens',
        'reasoning_tokens',
        'reasoningOutputTokens',
        'reasoning_output_tokens',
    )
    const outputTokens = readTokenCount(
        usage,
        'outputTokens',
        'output_tokens',
        'completionTokens',
        'completion_tokens',
    )
    const explicitTotal = readTokenCount(usage, 'totalTokens', 'total_tokens')
    const totalTokens =
        explicitTotal ??
        (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null)
    return inputTokens === null &&
        textInputTokens === null &&
        imageInputTokens === null &&
        cachedInputTokens === null &&
        reasoningTokens === null &&
        outputTokens === null &&
        totalTokens === null
        ? null
        : {
              inputTokens,
              textInputTokens,
              imageInputTokens,
              cachedInputTokens,
              reasoningTokens,
              outputTokens,
              totalTokens,
          }
}
