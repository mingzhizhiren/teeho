import { describe, expect, it } from 'vitest'
import { selectModelCohort, type ScoredCandidate } from './analysis.model-cohort'

function note(
    noteId: string,
    score: number,
    fields: Partial<ScoredCandidate> = {},
): ScoredCandidate {
    return { noteId, score, sources: ['sql'], ...fields }
}

function withBaseline(candidates: readonly ScoredCandidate[]): ScoredCandidate[] {
    return [...candidates, ...candidates.map((_, index) => note(`baseline-${index}`, 0))]
}

function ids(result: ReturnType<typeof selectModelCohort>): string[] {
    return result.display.map((item) => item.noteId)
}

describe('按档位选择模型优秀群体中的抽样池', () => {
    it('付费互动门槛严格大于且必须同时满足，缺失互动不视为达标', () => {
        const preferred = Array.from({ length: 10 }, (_, index) =>
            note(`preferred-${index}`, 6, { likes: 101, collects: 31 }),
        )
        const boundary = [
            note('likes-at-threshold', 9, { likes: 100, collects: 31 }),
            note('collects-at-threshold', 9, { likes: 101, collects: 30 }),
            note('both-at-threshold', 9, { likes: 100, collects: 30 }),
            note('only-likes', 9, { likes: 999 }),
            note('only-collects', 9, { collects: 999 }),
            note('unknown-engagement', 9),
        ]
        const candidates = withBaseline([...preferred, ...boundary]).map((candidate) =>
            candidate.noteId === 'baseline-0'
                ? { ...candidate, likes: 999, collects: 999 }
                : candidate,
        )
        const paid = selectModelCohort(candidates, () => 0, 'engagement_priority')
        const free = selectModelCohort(candidates, () => 0, 'standard')
        expect(new Set(ids(paid))).toEqual(new Set(preferred.map((item) => item.noteId)))
        expect(paid.median).toBe(3)
        expect(paid.median).toBe(free.median)
        expect(paid.excellentIds).toEqual(free.excellentIds)
        expect(paid.excellentIds).toHaveLength(16)
        expect(paid.excellentIds).toContain('likes-at-threshold')
        expect(paid.excellentIds).not.toContain('baseline-0')
    })

    it('达标不足十篇时按模型分补入未达标项，不把互动门槛变成淘汰条件', () => {
        const preferred = [note('preferred', 6, { likes: 101, collects: 31 })]
        const others = Array.from({ length: 11 }, (_, index) =>
            note(`ordinary-${index}`, 9 - index / 10),
        )
        const result = selectModelCohort(
            withBaseline([...preferred, ...others]),
            () => 0,
            'engagement_priority',
        )
        expect(new Set(ids(result))).toEqual(
            new Set(['preferred', ...others.slice(0, 9).map((item) => item.noteId)]),
        )
        expect(result.excellentIds).toContain('ordinary-10')
    })

    it('付费同组先比较模型分，再用笔记身份打破并列，不从前十池外补位', () => {
        const higher = Array.from({ length: 9 }, (_, index) =>
            note(`higher-${index}`, 8, { likes: 101, collects: 31 }),
        )
        const candidates = withBaseline([
            ...higher,
            note('tie-b', 7, { likes: 101, collects: 31 }),
            note('tie-a', 7, { likes: 101, collects: 31 }),
            note('higher-but-unqualified', 10),
        ])
        const result = selectModelCohort(candidates, () => 0, 'engagement_priority')
        expect(new Set(ids(result))).toEqual(
            new Set([...higher.map((item) => item.noteId), 'tie-a']),
        )
        expect(result.excellentIds).toContain('tie-b')
        expect(result.excellentIds).toContain('higher-but-unqualified')
    })

    it('免费按模型分取前二十，可抽中第十一至二十，第二十一即使互动达标也不进入池', () => {
        const ranked = Array.from({ length: 21 }, (_, index) =>
            note(`rank-${index + 1}`, 10 - index / 10, {
                likes: index === 20 ? 999 : 0,
                collects: index === 20 ? 999 : 0,
            }),
        )
        let draw = 0
        const reverseOrder = (): number => 1 - ++draw / 100
        const result = selectModelCohort(withBaseline(ranked), reverseOrder, 'standard')
        expect(new Set(ids(result))).toEqual(
            new Set(ranked.slice(10, 20).map((item) => item.noteId)),
        )
        expect(result.excellentIds).toContain('rank-21')
        expect(ids(result)).not.toContain('rank-21')
    })

    it.each(['standard', 'engagement_priority'] as const)(
        '%s 对两路重叠候选去重，保留免费、Coffee、Plus 前缀来源配额',
        (mode) => {
            const shared = Array.from({ length: 5 }, (_, index) =>
                note(`shared-${index}`, 7, {
                    sources: ['sql', 'semantic'],
                    likes: 101,
                    collects: 31,
                }),
            )
            const separate = (source: 'sql' | 'semantic'): ScoredCandidate[] =>
                Array.from({ length: 5 }, (_, index) =>
                    note(`${source}-${index}`, 7, {
                        sources: [source],
                        likes: 101,
                        collects: 31,
                    }),
                )
            const candidates = [...shared, ...separate('sql'), ...separate('semantic')]
            const result = selectModelCohort(candidates, () => 0, mode)
            expect(new Set(ids(result)).size).toBe(10)
            for (const [limit, quota] of [
                [4, 2],
                [8, 4],
                [10, 5],
            ] as const) {
                const prefix = result.display.slice(0, limit)
                expect(prefix.filter((item) => item.source === 'sql')).toHaveLength(quota)
                expect(prefix.filter((item) => item.source === 'semantic')).toHaveLength(quota)
            }
            for (const item of result.display) {
                expect(
                    candidates.find((candidate) => candidate.noteId === item.noteId)?.sources,
                ).toContain(item.source)
            }
        },
    )
})
