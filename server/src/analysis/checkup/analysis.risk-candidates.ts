import { z } from 'zod'
import databaseJson from '../../../../skills/teeho/resources/risk-database.json'
import type { AgentResultGenerationInput } from '../providers/analysis.provider'
import type { ContentLocation } from './analysis.content-analysis'
import { resolveAnalysisTrackCode } from '../tracks/analysis.tracks'

const LIMITS = { context: 80, term: 500, pattern: 1000 } as const
const MAXIMUM_TRACK_CODE = 30
const MAXIMUM_NOTE_TRACKS = 4
const riskLevelSchema = z.enum(['high', 'medium', 'low'])
const trackScopeSchema = z.array(z.number().int().min(1).max(MAXIMUM_TRACK_CODE)).nullable()
const databaseSchema = z.object({
    categories: z.array(
        z.object({
            name: z.string(),
            riskLevel: riskLevelSchema,
            trackCodes: trackScopeSchema,
            context: z.string(),
            words: z.array(z.string().min(1).max(LIMITS.term)),
        }),
    ),
    patterns: z.array(
        z.object({
            name: z.string(),
            context: z.string(),
            pattern: z.string().max(LIMITS.pattern),
            riskLevel: riskLevelSchema,
            trackCodes: trackScopeSchema,
        }),
    ),
    rules: z.array(z.object({ context: z.string() })),
})
const database = databaseSchema.parse(databaseJson)
export interface RiskCandidate {
    riskLevel: z.infer<typeof riskLevelSchema>
    id: string
    term: string
    category: string
    context: string
    location: ContentLocation
    evidence: string
    line: number
}

/** 保留来源字段供最终解释定位，素材部分引用已有理解描述。 */
export function contentEvidence(
    input: AgentResultGenerationInput,
): Record<ContentLocation, string> {
    return {
        title: input.task.fields.title.value,
        body: input.task.fields.body.value,
        topics: input.task.fields.topics.value.join('\n'),
        cover: input.materialDescriptions?.cover ?? '',
        content: input.materialDescriptions?.content ?? '',
    }
}

const literalPatterns = database.categories.flatMap((category) =>
    category.words.map((word) => ({
        category: category.name,
        riskLevel: category.riskLevel,
        trackCodes: category.trackCodes,
        context: category.context,
        pattern: new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'),
    })),
)
// 数据中的模式来自 Python 词库，双重转义只还原一层；只接受当前可在 JS 中编译的静态模式。
const formatPatterns = database.patterns.map((row) => ({
    category: row.name,
    riskLevel: row.riskLevel,
    trackCodes: row.trackCodes,
    context: row.context,
    pattern: new RegExp(row.pattern.replaceAll('\\\\', '\\'), 'giu'),
}))

/** 程序直接匹配静态词库，每个字段的同词同类合并展示；不交由 Agent 过滤。 */
export function collectRiskCandidates(
    input: AgentResultGenerationInput,
    trackCodes?: readonly number[],
): RiskCandidate[] {
    const selected = new Set(
        [
            ...(trackCodes ?? [
                input.materialDescriptions?.primaryTrack ??
                    resolveAnalysisTrackCode(input.task.fields.track.value),
                ...(input.materialDescriptions?.secondaryTracks ?? []),
            ]),
        ].filter((code) => Number.isInteger(code) && code >= 1 && code <= MAXIMUM_TRACK_CODE),
    )
    const noteTracks = [...selected].slice(0, MAXIMUM_NOTE_TRACKS)
    const activePatterns = [...literalPatterns, ...formatPatterns].filter(
        (row) =>
            row.trackCodes === null || row.trackCodes.some((code) => noteTracks.includes(code)),
    )
    // 素材理解描述用于一致性分析，不是用户原文；未接入独立 OCR 原文前不扫描素材。
    const { title, body, topics } = contentEvidence(input)
    const matches = Object.entries({ title, body, topics }).flatMap(([location, text]) =>
        activePatterns.flatMap(({ pattern, category, context, riskLevel }) =>
            Array.from(text.matchAll(pattern))
                .filter((match) => match[0].length > 0)
                .map((match) => {
                    const at = match.index ?? 0
                    const term = match[0].slice(0, LIMITS.term)
                    const start = Math.max(
                        0,
                        at - Math.min(LIMITS.context, LIMITS.term - term.length),
                    )
                    return {
                        id: '',
                        riskLevel,
                        line: text.slice(0, at).split('\n').length,
                        term,
                        category,
                        context,
                        location: location as ContentLocation,
                        evidence: text.slice(
                            start,
                            Math.min(start + LIMITS.term, at + term.length + LIMITS.context),
                        ),
                    }
                }),
        ),
    )
    return matches.map((candidate, index) => ({ ...candidate, id: `r${index + 1}` }))
}

/** 语义规则很短，保留适用条件随候选送审。 */
export const riskSemanticRules: readonly string[] = database.rules.map((rule) => rule.context)
