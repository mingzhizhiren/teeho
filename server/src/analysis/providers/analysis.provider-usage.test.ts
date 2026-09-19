import { describe, expect, it } from 'vitest'

import { normalizeAgentProviderUsage } from './analysis.provider-usage'

describe('Agent Provider usage normalization', () => {
    it('保留文字、图片、缓存、推理和输出用量，不把缺失字段伪造为零', () => {
        expect(
            normalizeAgentProviderUsage({
                input_tokens: 120,
                text_input_tokens: 80,
                image_input_tokens: 40,
                cached_input_tokens: 25,
                reasoning_output_tokens: 15,
                output_tokens: 30,
                total_tokens: 150,
            }),
        ).toEqual({
            inputTokens: 120,
            textInputTokens: 80,
            imageInputTokens: 40,
            cachedInputTokens: 25,
            reasoningTokens: 15,
            outputTokens: 30,
            totalTokens: 150,
        })

        expect(normalizeAgentProviderUsage({ outputTokens: 7 })).toEqual({
            inputTokens: null,
            textInputTokens: null,
            imageInputTokens: null,
            cachedInputTokens: null,
            reasoningTokens: null,
            outputTokens: 7,
            totalTokens: null,
        })
        expect(normalizeAgentProviderUsage({ inputTokens: -1, outputTokens: '7' })).toBeNull()
    })

    it('只在输入与输出都已知时推导总量', () => {
        expect(normalizeAgentProviderUsage({ inputTokens: 5, outputTokens: 3 })).toMatchObject({
            totalTokens: 8,
        })
        expect(normalizeAgentProviderUsage({ inputTokens: 5 })).toMatchObject({
            totalTokens: null,
        })
    })
})
