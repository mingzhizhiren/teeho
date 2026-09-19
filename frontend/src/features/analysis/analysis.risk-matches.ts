import database from '../../../../skills/teeho/resources/risk-database.json'
import type { ContentAnalysis } from './analysis.content-analysis'

export type RiskMatch = ContentAnalysis['termRisks'][number]
export type RiskTextFields = Readonly<Record<'title' | 'body' | 'topics', string>>
const EVIDENCE_CONTEXT = 80
const MAXIMUM_FINDING_TEXT = 500
const MAXIMUM_TRACK_COUNT = 4
const MAXIMUM_TRACK_CODE = 30
interface ScopedVocabulary {
    name: string
    trackCodes?: readonly number[] | null
}

/** 所有已识别关键词取并集，忽略权重；未分类只使用通用词库。 */
export function riskTrackCodes(report: {
    primaryTrack: number
    secondaryTracks?: readonly number[]
    insight?: { tracks?: readonly { trackCode: number }[] } | null
}): number[] {
    return normalizeTrackCodes([
        report.primaryTrack,
        ...(report.secondaryTracks ??
            report.insight?.tracks?.map((track) => track.trackCode) ??
            []),
    ])
}

function normalizeTrackCodes(trackCodes: readonly number[]): number[] {
    return [
        ...new Set(
            trackCodes.filter(
                (code) => Number.isInteger(code) && code >= 1 && code <= MAXIMUM_TRACK_CODE,
            ),
        ),
    ].slice(0, MAXIMUM_TRACK_COUNT)
}

function appliesToTracks(scope: ScopedVocabulary, trackCodes: readonly number[]): boolean {
    return scope.trackCodes == null || scope.trackCodes.some((code) => trackCodes.includes(code))
}

const categoryScopes: readonly ScopedVocabulary[] = [...database.categories, ...database.patterns]
const patterns = [
    ...database.categories.flatMap((category) =>
        category.words.map((word) => ({
            category: category.name,
            scope: category as ScopedVocabulary,
            description: category.context,
            expression: new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'),
        })),
    ),
    ...database.patterns.map((pattern) => ({
        category: pattern.name,
        scope: pattern as ScopedVocabulary,
        description: pattern.context,
        expression: new RegExp(pattern.pattern.split('\\\\').join('\\'), 'giu'),
    })),
]

/** 为旧报告直接匹配原始笔记，结果不依赖 Agent 是否成功。 */
export function matchNoteRiskWords(
    fields: RiskTextFields,
    trackCodes: readonly number[] = [],
): RiskMatch[] {
    const scopes = normalizeTrackCodes(trackCodes)
    const selectedPatterns = patterns.filter(({ scope }) => appliesToTracks(scope, scopes))
    const matches = (Object.keys(fields) as Array<keyof RiskTextFields>).flatMap((location) =>
        selectedPatterns.flatMap(({ category, description, expression }) =>
            Array.from(fields[location].matchAll(expression))
                .filter((match) => match[0].length > 0)
                .map((match) => {
                    const term = match[0].slice(0, MAXIMUM_FINDING_TEXT)
                    const start = Math.max(
                        0,
                        match.index -
                            Math.min(EVIDENCE_CONTEXT, MAXIMUM_FINDING_TEXT - term.length),
                    )
                    return {
                        term,
                        category,
                        description,
                        location,
                        evidence: fields[location].slice(
                            start,
                            Math.min(
                                start + MAXIMUM_FINDING_TEXT,
                                match.index + term.length + EVIDENCE_CONTEXT,
                            ),
                        ),
                    }
                }),
        ),
    )
    return [
        ...new Map(
            matches.map((match) => [
                `${match.location}:${match.term.toLowerCase()}:${match.category}`,
                match,
            ]),
        ).values(),
    ].sort((left, right) => right.term.length - left.term.length)
}

/** 新报告使用已保存的直接匹配结果，旧报告从任务原文补齐。 */
export function resolveRiskMatches(
    saved: readonly RiskMatch[] | undefined,
    fields: RiskTextFields,
    trackCodes: readonly number[] = [],
): readonly RiskMatch[] {
    const scopes = normalizeTrackCodes(trackCodes)
    return (
        saved?.filter((match) => {
            // 历史素材命中来自 Agent 描述，不能作为原文风险继续展示。
            if (match.location === 'cover' || match.location === 'content') return false
            const categories = categoryScopes.filter((category) => category.name === match.category)
            return (
                categories.length === 0 ||
                categories.some((category) => appliesToTracks(category, scopes))
            )
        }) ?? matchNoteRiskWords(fields, scopes)
    )
}

/** 将全部命中区间合并为安全文本片段，保留重复词、原始大小写及换行。 */
export function riskTextSegments(
    text: string,
    terms: readonly string[],
): Array<{ start: number; text: string; matched: boolean }> {
    const ranges = terms
        .filter(Boolean)
        .flatMap((term) => {
            const expression = new RegExp(
                `(?=(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}))`,
                'giu',
            )
            return Array.from(text.matchAll(expression), (match) => ({
                start: match.index,
                end: match.index + match[1].length,
            }))
        })
        .sort((left, right) => left.start - right.start)
    const merged = ranges.reduce<Array<{ start: number; end: number }>>((result, range) => {
        const previous = result[result.length - 1]
        return previous && range.start <= previous.end
            ? [
                  ...result.slice(0, -1),
                  { start: previous.start, end: Math.max(previous.end, range.end) },
              ]
            : [...result, range]
    }, [])
    const segments = merged.flatMap((range, index) => {
        const start = merged[index - 1]?.end ?? 0
        return [
            ...(start < range.start
                ? [{ start, text: text.slice(start, range.start), matched: false }]
                : []),
            { start: range.start, text: text.slice(range.start, range.end), matched: true },
        ]
    })
    const end = merged[merged.length - 1]?.end ?? 0
    return [
        ...segments,
        ...(end < text.length ? [{ start: end, text: text.slice(end), matched: false }] : []),
    ]
}
