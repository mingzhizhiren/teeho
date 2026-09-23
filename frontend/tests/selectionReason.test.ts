import { expect, test } from 'bun:test'
import { presentReference, selectionReason } from '@/features/analysis/analysis.selection-reason'

test('所有参考来源使用原有互动分档，不输出精确数量', () => {
    for (const reason of ['semantic_similarity', 'similar_content', 'reference_note']) {
        expect(
            presentReference(
                { likes: 2847, collects: 2639, comments: 41, reason },
                {
                    rapidGrowth: '快速增长',
                },
            ).counts,
        ).toEqual({ likes: '1K+', collects: '1K+', comments: '10+' })
        expect(
            presentReference(
                { likes: 1, collects: 0, comments: null, reason },
                {
                    rapidGrowth: '快速增长',
                },
            ).counts,
        ).toEqual({ likes: '快速增长', collects: '快速增长', comments: '快速增长' })
    }
})

test('三项同时达到阈值才显示曝光量大，按原始值判断边界', () => {
    const eligible = { likes: 10_000, collects: 1_000, comments: 100 }
    expect(selectionReason(eligible)).toBe('high_exposure')
    for (const note of [
        { ...eligible, likes: 9_999 },
        { ...eligible, collects: 999 },
        { ...eligible, comments: 99 },
        { ...eligible, comments: null },
        { ...eligible, likes: Infinity },
    ])
        expect(selectionReason(note)).toBe('rapid_growth')
})
