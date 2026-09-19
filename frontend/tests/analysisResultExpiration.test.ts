import { describe, expect, test } from 'bun:test'

import { isAnalysisResultExpired } from '@/features/analysis/analysis.result-expiration'

describe('analysis result expiration', () => {
    const savedAt = '2026-09-01T00:00:00.000Z'

    test('本地历史保存未满 24 小时不标记过期', () => {
        expect(isAnalysisResultExpired(savedAt, Date.parse('2026-09-01T23:59:59.999Z'))).toBe(false)
    })

    test('本地历史保存满 24 小时标记过期', () => {
        expect(isAnalysisResultExpired(savedAt, Date.parse('2026-09-02T00:00:00.000Z'))).toBe(true)
    })

    test('缺少或损坏的本地时间不猜测过期', () => {
        expect(isAnalysisResultExpired(null, Date.parse('2026-09-02T00:00:00.000Z'))).toBe(false)
        expect(isAnalysisResultExpired('invalid', Date.parse('2026-09-02T00:00:00.000Z'))).toBe(
            false,
        )
    })
})
