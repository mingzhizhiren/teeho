import { describe, expect, test } from 'bun:test'

import { selectAnalysisRitualVariant } from '@/features/analysis/analysis.ritual'

describe('analysis ritual selection', () => {
    test.each([
        [0, 'A'],
        [0.34, 'B'],
        [0.99, 'C'],
    ] as const)('随机值 %s 选择动画 %s', (randomValue, expectedVariant) => {
        expect(selectAnalysisRitualVariant(() => randomValue)).toBe(expectedVariant)
    })

    test('异常随机值不会产生未定义动画', () => {
        expect(selectAnalysisRitualVariant(() => 1)).toBe('A')
    })
})
