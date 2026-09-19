import { expect, test } from 'bun:test'
import { selectionReason } from '@/features/analysis/analysis.selection-reason'

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
