import { describe, expect, test } from 'bun:test'
import {
    structureDifferenceState,
    type StructureMetrics,
} from '../src/features/analysis/analysis.structure-metrics'

describe('结构指标三档偏差文案', () => {
    const directions: readonly [keyof StructureMetrics, number, string][] = [
        ['bodyLength', 1, 'short'],
        ['videoDurationSeconds', 30, 'long'],
        ['imageCount', 1, 'few'],
        ['topicCount', 30, 'many'],
    ]
    for (const [severity, prefix] of [
        ['minor', 'slightly_'],
        ['moderate', ''],
        ['major', ''],
        ['critical', 'too_'],
    ] as const) {
        test(`${severity} 保留方向并使用对应档位`, () => {
            const reference = { low: 10, high: 20, sampleCount: 3, severity }
            for (const [metric, value, direction] of directions) {
                expect(structureDifferenceState(metric, value, reference)).toBe(prefix + direction)
            }
            expect(structureDifferenceState('bodyLength', 10, reference)).toBe('within')
            expect(structureDifferenceState('bodyLength', 20, reference)).toBe('within')
            expect(structureDifferenceState('bodyLength', null, reference)).toBeNull()
            expect(structureDifferenceState('bodyLength', 1, null)).toBeNull()
        })
    }
})
