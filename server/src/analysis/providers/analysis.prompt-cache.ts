import { createHash } from 'node:crypto'

import {
    AGENT_REQUEST_DIAGNOSTICS_VERSION,
    type AgentRequestDiagnostics,
    type AgentUsageCallStage,
} from '../usage/analysis.agent-usage.contract'
import type { AgentImageAsset } from './analysis.provider'

type CodexCachedStage = AgentUsageCallStage

interface CodexPromptCacheContract {
    schemaVersion: string
    toolConfigurationVersion: string
}

/** Codex 自动缓存边界使用的稳定阶段契约；没有显式 cache key。 */
export const codexPromptCacheContracts = {
    form_conversation_turn: {
        schemaVersion: 'conversation-turn.schema.v6',
        toolConfigurationVersion: 'codex-tools-disabled.v1',
    },
    collect_web_research: {
        schemaVersion: 'web-research.schema.v2',
        toolConfigurationVersion: 'codex-web-search-live.v1',
    },
    generate_result: {
        schemaVersion: 'generate-result.schema.v8',
        toolConfigurationVersion: 'codex-tools-disabled.v1',
    },
    repair_agent_output: {
        schemaVersion: 'repair-result.schema.v5',
        toolConfigurationVersion: 'codex-tools-disabled.v1',
    },
} as const satisfies Record<CodexCachedStage, CodexPromptCacheContract>

export interface CodexRequestDiagnosticContext extends CodexPromptCacheContract {
    stage: CodexCachedStage
    promptVersion: string
    historyTexts?: readonly string[]
    evidenceTexts?: readonly string[]
    videoFrameCount?: number
}

interface CreateCodexRequestDiagnosticsInput extends CodexRequestDiagnosticContext {
    model: string
    reasoningEffort: 'none' | 'low'
    prompt: string
    outputSchema: Record<string, unknown>
    images: readonly AgentImageAsset[]
    imageDetail: AgentRequestDiagnostics['images'][number]['detail']
}

function canonicalValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => canonicalValue(item))
    if (typeof value !== 'object' || value === null) return value
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, child]) => [key, canonicalValue(child)]),
    )
}

function canonicalJson(value: unknown): string {
    return JSON.stringify(canonicalValue(value))
}

function sha256(value: string | Uint8Array): string {
    return createHash('sha256').update(value).digest('hex')
}

function stablePromptPrefix(prompt: string): string {
    const payloadBoundary = prompt.lastIndexOf('\n\n')
    return payloadBoundary < 0 ? prompt : prompt.slice(0, payloadBoundary)
}

function totalCharacters(values: readonly string[]): number {
    return values.reduce((total, value) => total + Array.from(value).length, 0)
}

/** 创建不含 Prompt、正文、资源标识或媒体内容的缓存边界与输入体积诊断。 */
export function createCodexRequestDiagnostics(
    input: CreateCodexRequestDiagnosticsInput,
): AgentRequestDiagnostics {
    const stablePrefix = stablePromptPrefix(input.prompt)
    const serializedSchema = canonicalJson(input.outputSchema)
    const imageBoundary = input.images.map((image) => ({
        contentSha256: sha256(image.content),
        mediaType: image.mediaType,
        width: image.width,
        height: image.height,
        detail: input.imageDetail,
    }))
    const cacheBoundaryFingerprint = sha256(
        canonicalJson({
            provider: 'codex-cli',
            model: input.model,
            reasoningEffort: input.reasoningEffort,
            stage: input.stage,
            promptVersion: input.promptVersion,
            targetSchemaVersion: input.schemaVersion,
            toolConfigurationVersion: input.toolConfigurationVersion,
            stablePrefixSha256: sha256(stablePrefix),
            schemaSha256: sha256(serializedSchema),
            images: imageBoundary,
        }),
    )
    const historyTexts = input.historyTexts ?? []
    const evidenceTexts = input.evidenceTexts ?? []
    const videoFrameCount = input.videoFrameCount ?? 0
    return {
        schemaVersion: AGENT_REQUEST_DIAGNOSTICS_VERSION,
        cacheBoundaryFingerprint,
        promptVersion: input.promptVersion,
        targetSchemaVersion: input.schemaVersion,
        toolConfigurationVersion: input.toolConfigurationVersion,
        promptCharacterCount: Array.from(input.prompt).length,
        stablePrefixCharacterCount: Array.from(stablePrefix).length,
        schemaCharacterCount: Array.from(serializedSchema).length,
        historyItemCount: historyTexts.length,
        historyCharacterCount: totalCharacters(historyTexts),
        evidenceNoteCount: evidenceTexts.length,
        evidenceCharacterCount: totalCharacters(evidenceTexts),
        imageCount: Math.max(0, input.images.length - videoFrameCount),
        videoFrameCount,
        images: input.images.map((image) => ({
            width: image.width,
            height: image.height,
            detail: input.imageDetail,
        })),
    }
}
