import { analysisWebResearchConstraints } from '../analysis.constants'
import { agentPromptCatalog } from '../providers/analysis.prompt.constants'
import { createWebResearchProviderDto } from '../providers/analysis.provider-dto'
import type { WebResearchCollectionInput } from './analysis.research-provider'

type JsonSchema = Record<string, unknown>

const webResearchSourceJsonSchema: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'site', 'publishedAt', 'url', 'sourceType'],
    properties: {
        title: {
            type: 'string',
            minLength: 1,
            maxLength: analysisWebResearchConstraints.sourceTitleMaxLength,
        },
        site: {
            type: 'string',
            minLength: 1,
            maxLength: analysisWebResearchConstraints.sourceSiteMaxLength,
        },
        publishedAt: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T' },
        url: { type: 'string', pattern: '^https://' },
        sourceType: {
            type: 'string',
            enum: [
                'official',
                'government',
                'brand',
                'academic',
                'authoritative_media',
                'industry_report',
                'community',
            ],
        },
    },
}

const webResearchFactJsonSchema: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['text', 'sourceUrls'],
    properties: {
        text: {
            type: 'string',
            minLength: 1,
            maxLength: analysisWebResearchConstraints.factMaxLength,
        },
        sourceUrls: {
            type: 'array',
            minItems: 1,
            maxItems: analysisWebResearchConstraints.maxSources,
            items: { type: 'string', pattern: '^https://' },
        },
    },
}

const webResearchConflictJsonSchema: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['draftClaim', 'externalFinding', 'sourceUrls'],
    properties: {
        draftClaim: {
            type: 'string',
            minLength: 1,
            maxLength: analysisWebResearchConstraints.factMaxLength,
        },
        externalFinding: {
            type: 'string',
            minLength: 1,
            maxLength: analysisWebResearchConstraints.factMaxLength,
        },
        sourceUrls: {
            type: 'array',
            minItems: 1,
            maxItems: analysisWebResearchConstraints.maxSources,
            items: { type: 'string', pattern: '^https://' },
        },
    },
}

/** Codex 联网阶段的单根对象 Schema；双分支关系由 Zod 契约校验。 */
export const webResearchJsonSchema: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'summary', 'keyFacts', 'conflicts', 'sources'],
    properties: {
        status: { type: 'string', enum: ['collected', 'no_sources'] },
        summary: {
            type: ['string', 'null'],
            minLength: 1,
            maxLength: analysisWebResearchConstraints.summaryMaxLength,
        },
        keyFacts: {
            type: 'array',
            maxItems: analysisWebResearchConstraints.maxFacts,
            items: webResearchFactJsonSchema,
        },
        conflicts: {
            type: 'array',
            maxItems: analysisWebResearchConstraints.maxConflicts,
            items: webResearchConflictJsonSchema,
        },
        sources: {
            type: 'array',
            maxItems: analysisWebResearchConstraints.maxSources,
            items: webResearchSourceJsonSchema,
        },
    },
}

/** 只投影已确认字段、允许查询和单次预算的联网研究提示。 */
export function createWebResearchPrompt(input: WebResearchCollectionInput): string {
    return [
        agentPromptCatalog.collectWebResearch.systemPrompt,
        agentPromptCatalog.collectWebResearch.instructions,
        JSON.stringify(createWebResearchProviderDto(input)),
    ].join('\n\n')
}
