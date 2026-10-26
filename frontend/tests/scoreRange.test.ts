import { describe, expect, test } from 'bun:test'
import { scoreRangePosition } from '../src/features/analysis/analysis.score-range'

describe('saved score range position', () => {
    const reference = { min: 5.41, median: 6.83, max: 7.87 }
    test('maps the saved score and actual median onto the reference extremes', () => {
        const result = scoreRangePosition(7.11, reference)!
        expect(result.percent).toBeCloseTo(69.10569)
        expect(result.medianPercent).toBeCloseTo(57.72358)
        expect(result.boundary).toBe('within')
    })
    test('keeps endpoint pointers bounded and distinguishes scores outside the range', () => {
        expect(scoreRangePosition(5.41, reference)).toMatchObject({
            percent: 0,
            boundary: 'within',
        })
        expect(scoreRangePosition(7.87, reference)).toMatchObject({
            percent: 100,
            boundary: 'within',
        })
        expect(scoreRangePosition(0, reference)).toMatchObject({ percent: 0, boundary: 'below' })
        expect(scoreRangePosition(10, reference)).toMatchObject({ percent: 100, boundary: 'above' })
    })
    test('never invents a percentage for missing, flat or invalid evidence', () => {
        for (const invalid of [
            null,
            {},
            { min: 5, max: 5, median: 5 },
            { min: 6, max: 5, median: 5 },
            { min: 0, max: 10, median: 11 },
            { min: NaN, max: 10, median: 5 },
        ]) {
            expect(scoreRangePosition(7.11, invalid)).toBeNull()
        }
        expect(scoreRangePosition(Infinity, reference)).toBeNull()
        expect(scoreRangePosition(0, { min: 0, max: 10, median: 0 })?.percent).toBe(0)
    })
})
