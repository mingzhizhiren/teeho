import { describe, expect, it } from 'vitest'

import { codexPromptCacheContracts, createCodexRequestDiagnostics } from './analysis.prompt-cache'
import type { AgentImageAsset } from './analysis.provider'

function image(reference: string, byte: number): AgentImageAsset {
    return {
        reference,
        mediaType: 'image/webp',
        byteSize: 1,
        width: 100 + byte,
        height: 80,
        content: new Uint8Array([byte]),
        availability: 'processed_private',
    }
}

function diagnostics(overrides: Partial<Parameters<typeof createCodexRequestDiagnostics>[0]> = {}) {
    return createCodexRequestDiagnostics({
        model: 'gpt-5.6-sol',
        reasoningEffort: 'low',
        stage: 'generate_result',
        promptVersion: 'generate-result.v8',
        schemaVersion: 'generate-result.schema.v6',
        toolConfigurationVersion: 'codex-tools-disabled.v1',
        prompt: 'stable system\n\nstable instructions\n\n{"userText":"secret-a"}',
        outputSchema: {
            type: 'object',
            properties: { result: { type: 'string' } },
        },
        images: [image('first-secret-reference', 1), image('second', 2)],
        imageDetail: 'provider_default',
        historyTexts: ['secret-history'],
        evidenceTexts: ['secret-evidence'],
        videoFrameCount: 0,
        ...overrides,
    })
}

describe('Codex automatic prompt cache boundary', () => {
    it('动态用户内容不改变稳定前缀指纹，诊断只保留数量、尺寸和版本', () => {
        const first = diagnostics()
        const second = diagnostics({
            prompt: 'stable system\n\nstable instructions\n\n{"userText":"a different and longer secret"}',
            historyTexts: ['different secret history'],
            evidenceTexts: ['different secret evidence'],
        })

        expect(second.cacheBoundaryFingerprint).toBe(first.cacheBoundaryFingerprint)
        expect(first).toMatchObject({
            schemaVersion: 'agent-request-diagnostics.v1',
            promptVersion: 'generate-result.v8',
            targetSchemaVersion: 'generate-result.schema.v6',
            toolConfigurationVersion: 'codex-tools-disabled.v1',
            historyItemCount: 1,
            historyCharacterCount: 14,
            evidenceNoteCount: 1,
            evidenceCharacterCount: 15,
            imageCount: 2,
            videoFrameCount: 0,
            images: [
                { width: 101, height: 80, detail: 'provider_default' },
                { width: 102, height: 80, detail: 'provider_default' },
            ],
        })
        expect(JSON.stringify(first)).not.toMatch(/secret|userText|first-secret-reference/u)
    })

    it('视频帧与独立封面分别计数，诊断不包含媒体引用或字节', () => {
        const result = diagnostics({
            images: [image('private-cover', 1), image('private-frame', 2)],
            videoFrameCount: 1,
        })

        expect(result).toMatchObject({ imageCount: 1, videoFrameCount: 1 })
        expect(result.images).toEqual([
            { width: 101, height: 80, detail: 'provider_default' },
            { width: 102, height: 80, detail: 'provider_default' },
        ])
        expect(JSON.stringify(result)).not.toMatch(/private-|reference|content/iu)
    })

    it('模型、阶段、Prompt、Schema、工具、图片顺序或 detail 变化形成新边界', () => {
        const base = diagnostics()
        const variants = [
            diagnostics({ model: 'gpt-5.6-terra' }),
            diagnostics({ stage: 'repair_agent_output' }),
            diagnostics({ promptVersion: 'generate-result.v9' }),
            diagnostics({ schemaVersion: 'generate-result.schema.v7' }),
            diagnostics({
                outputSchema: {
                    type: 'object',
                    properties: { changed: { type: 'boolean' } },
                },
            }),
            diagnostics({ toolConfigurationVersion: 'codex-web-search-live.v1' }),
            diagnostics({
                images: [image('second', 2), image('first-secret-reference', 1)],
            }),
            diagnostics({ imageDetail: 'low' }),
        ]

        expect(
            new Set([
                base.cacheBoundaryFingerprint,
                ...variants.map((variant) => variant.cacheBoundaryFingerprint),
            ]),
        ).toHaveLength(variants.length + 1)
    })

    it('四个 Agent 阶段都声明稳定 Schema 与工具配置版本', () => {
        expect(Object.keys(codexPromptCacheContracts).sort()).toEqual([
            'collect_web_research',
            'form_conversation_turn',
            'generate_result',
            'repair_agent_output',
        ])
        expect(Object.values(codexPromptCacheContracts)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    schemaVersion: expect.stringMatching(/\.schema\.v\d+$/u),
                    toolConfigurationVersion: expect.stringMatching(/^codex-/u),
                }),
            ]),
        )
    })
})
