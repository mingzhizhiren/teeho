import type { z } from 'zod'
import type { riskMatchSchema } from './analysis.content-analysis'

/** 后端冻结的风险命中，浏览器不重新匹配或筛选。 */
export type RiskMatch = z.infer<typeof riskMatchSchema>

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
