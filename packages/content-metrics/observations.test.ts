import { expect, test } from 'bun:test'
import {
    comparePerformanceObservations,
    performanceWindowStart,
    scorePerformance,
} from './observations'
import { extractStructureFeatures } from './structure'

test('案例排序只使用截止时点前的最新实际观察，不修改输入', () => {
    const observations = Object.freeze([
        Object.freeze({ observedAt: '2026-09-01T00:00:00Z', likes: 2, collects: 1 }),
        Object.freeze({ observedAt: '2026-09-03T00:00:00Z', likes: 999, collects: 999 }),
    ])
    const notes = [
        { publishedAt: '2026-08-31', observations },
        {
            publishedAt: '2026-08-31',
            observations: [{ observedAt: '2026-09-01T00:00:00Z', likes: 6, collects: null }],
        },
    ]
    expect(scorePerformance(notes, '2026-09-02T00:00:00Z')).toEqual([0.5, 1])
    expect(observations[0]!.likes).toBe(2)
    expect(scorePerformance([], '2026-09-02T00:00:00Z')).toEqual([])
    expect(() => scorePerformance(notes, 'invalid')).toThrow('invalid_observation_cutoff')
})

test('窗口使用上海自然日且观察同刻顺序稳定', () => {
    expect(new Date(performanceWindowStart('2026-09-02T00:00:00Z', 1)).toISOString()).toBe(
        '2026-09-01T16:00:00.000Z',
    )
    expect(() => performanceWindowStart('2026-09-02', 0)).toThrow()
    expect(
        comparePerformanceObservations(
            { observedAt: '2026-09-01', observationId: 'b' },
            { observedAt: '2026-09-01', observationId: 'a' },
        ),
    ).toBe(-1)
})

test('公开结构计数保留字素、段落与步骤语义', () => {
    expect(extractStructureFeatures('A🔥', '第一步 洗脸\n\n2. 防晒', ['通勤', ''])).toMatchObject({
        titleLength: 2,
        titleEmojiRatio: 0.5,
        listItemCount: 2,
        topicCount: 1,
    })
})
