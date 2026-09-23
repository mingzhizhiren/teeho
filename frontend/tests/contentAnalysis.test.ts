import { expect, test } from 'bun:test'
import { analysisResultSchema } from '@/features/analysis/analysis.contract'
import { readPrimaryScore } from '@/features/analysis/analysis.primary-score'
import {
    contentScoreRetention,
    expectedContentScore,
} from '@/features/analysis/analysis.content-analysis'
import { contentAnalysisFixture, fallbackContentAnalysisFixture } from './contentAnalysis.fixture'
import { checkupResult } from './checkupResult.fixture'

const newReport = {
    ...checkupResult,
    schemaVersion: 'analysis-result.v7',
    primaryScore: { source: 'insight', value: 7 },
    contentAnalysis: contentAnalysisFixture,
}

test('显式允许无参考的内容评分报告可读取，缺省及必需参考仍严格校验', () => {
    const report = {
        ...newReport,
        referenceRequirement: 'optional',
        contentAnalysis: {
            ...contentAnalysisFixture,
            scorePolicy: 'consistency-weighted.v2',
            consistency: { ...contentAnalysisFixture.consistency, stars: 3 },
            weaknesses: [],
        },
        insight: null,
        primaryScore: { source: 'radar_average', value: 7 },
        radar: Object.fromEntries(
            Object.keys(checkupResult.radar).map((dimension) => [dimension, 7]),
        ),
        comparisonNotes: [],
        differences: [],
    }
    expect(analysisResultSchema.safeParse(report).success).toBe(true)
    expect(
        analysisResultSchema.safeParse({ ...report, referenceRequirement: undefined }).success,
    ).toBe(false)
    expect(
        analysisResultSchema.safeParse({ ...report, referenceRequirement: 'required' }).success,
    ).toBe(false)
    expect(
        analysisResultSchema.safeParse({ ...report, referenceRequirement: 'invalid' }).success,
    ).toBe(false)
})

test('v122 新策略采用30%与60%，旧策略继续保持25%与50%', () => {
    for (const [policy, stars, expected] of [
        ['consistency-weighted.v2', 1, 2.4],
        ['consistency-weighted.v2', 2, 4.8],
        ['consistency-weighted.v1', 1, 2],
        ['consistency-weighted.v1', 2, 4],
    ] as const) {
        const contentAnalysis = {
            ...contentAnalysisFixture,
            originalScore: 8,
            scorePolicy: policy,
            consistency: { ...contentAnalysisFixture.consistency, stars },
        }
        const parsed = analysisResultSchema.parse({
            ...newReport,
            contentAnalysis,
            primaryScore: { source: 'insight', value: expected },
            insight: { ...checkupResult.insight, score: expected },
        })
        expect(readPrimaryScore(parsed).value).toBe(expected)
    }
})

test('新策略零星也不能交付无参考报告，旧零星历史继续可读', () => {
    const report = {
        ...newReport,
        primaryScore: { source: 'insight', value: 0 },
        insight: { ...checkupResult.insight, score: 0 },
        comparisonNotes: [],
        contentAnalysis: {
            ...contentAnalysisFixture,
            scorePolicy: 'consistency-weighted.v2',
            weaknesses: [],
            consistency: { ...contentAnalysisFixture.consistency, stars: 0 },
        },
    }
    expect(analysisResultSchema.safeParse(report).success).toBe(false)
})

test('new policy scales one and two stars across score sources with half-up boundaries', () => {
    for (const [stars, original, expected] of [
        [1, 4.42, 1.11],
        [2, 7, 3.5],
    ]) {
        for (const source of ['insight', 'radar_average'] as const) {
            const contentAnalysis = {
                ...contentAnalysisFixture,
                scorePolicy: 'consistency-weighted.v1' as const,
                originalScore: original!,
                consistency: { ...contentAnalysisFixture.consistency, stars: stars! },
            }
            const report = {
                ...newReport,
                contentAnalysis,
                primaryScore: { source, value: expected },
                insight:
                    source === 'insight' ? { ...checkupResult.insight, score: expected } : null,
                radar: Object.fromEntries(
                    Object.keys(checkupResult.radar).map((key) => [key, original]),
                ),
            }
            expect(readPrimaryScore(analysisResultSchema.parse(report)).value).toBe(expected!)
            expect(expectedContentScore(contentAnalysis)).toBe(expected!)
            expect(contentScoreRetention(contentAnalysis)).toBe(stars === 1 ? 25 : 50)
            expect(
                analysisResultSchema.safeParse({
                    ...report,
                    primaryScore: { source, value: original },
                }).success,
            ).toBe(false)
        }
    }
})

test('policy marker preserves legacy one/two-star scores and fallback three-star scores', () => {
    for (const stars of [1, 2, 3, 4, 5]) {
        const legacy = {
            ...contentAnalysisFixture,
            consistency: { ...contentAnalysisFixture.consistency, stars },
        }
        expect(expectedContentScore(legacy)).toBe(7)
        expect(contentScoreRetention(legacy)).toBeNull()
        if (stars >= 3)
            expect(
                expectedContentScore({ ...legacy, scorePolicy: 'consistency-weighted.v1' }),
            ).toBe(7)
    }
    const fallback = {
        ...fallbackContentAnalysisFixture,
        scorePolicy: 'consistency-weighted.v1' as const,
    }
    expect(
        readPrimaryScore(analysisResultSchema.parse({ ...newReport, contentAnalysis: fallback }))
            .value,
    ).toBe(7)
    expect(contentScoreRetention(fallback)).toBeNull()
})

test('content analysis preserves findings and accepts old saved reports without inventing stars', () => {
    expect(analysisResultSchema.parse(newReport).contentAnalysis).toEqual(contentAnalysisFixture)
    expect(analysisResultSchema.parse(checkupResult).contentAnalysis).toBeUndefined()
})

test('completed zero consistency requires final zero and evidence for insight reports', () => {
    const blocked = {
        ...contentAnalysisFixture,
        consistency: { ...contentAnalysisFixture.consistency, stars: 0 },
    }
    expect(analysisResultSchema.safeParse({ ...newReport, contentAnalysis: blocked }).success).toBe(
        false,
    )
    const valid = {
        ...newReport,
        contentAnalysis: blocked,
        primaryScore: { source: 'insight', value: 0 },
        insight: { ...checkupResult.insight, score: 0 },
    }
    expect(readPrimaryScore(analysisResultSchema.parse(valid)).value).toBe(0)
    expect(
        analysisResultSchema.safeParse({
            ...valid,
            contentAnalysis: { ...blocked, consistency: { ...blocked.consistency, issues: [] } },
        }).success,
    ).toBe(false)
})

test('radar average accepts a forced zero only for completed zero consistency', () => {
    const report = {
        ...newReport,
        insight: null,
        primaryScore: { source: 'radar_average', value: 0 },
        contentAnalysis: {
            ...contentAnalysisFixture,
            consistency: { ...contentAnalysisFixture.consistency, stars: 0 },
        },
    }
    expect(readPrimaryScore(analysisResultSchema.parse(report)).value).toBe(0)
    expect(analysisResultSchema.safeParse({ ...report, contentAnalysis: undefined }).success).toBe(
        false,
    )
    expect(
        analysisResultSchema.safeParse({
            ...report,
            contentAnalysis: fallbackContentAnalysisFixture,
        }).success,
    ).toBe(false)
})

test('fallback is exactly three stars and normal analysis keeps model score', () => {
    expect(
        readPrimaryScore(
            analysisResultSchema.parse({
                ...newReport,
                contentAnalysis: fallbackContentAnalysisFixture,
            }),
        ).value,
    ).toBe(7)
    expect(readPrimaryScore(analysisResultSchema.parse(newReport)).value).toBe(7)
    expect(
        analysisResultSchema.safeParse({
            ...newReport,
            contentAnalysis: {
                ...fallbackContentAnalysisFixture,
                consistency: { ...fallbackContentAnalysisFixture.consistency, stars: 5 },
            },
        }).success,
    ).toBe(false)
    expect(
        analysisResultSchema.safeParse({
            ...newReport,
            contentAnalysis: {
                ...contentAnalysisFixture,
                consistency: { ...contentAnalysisFixture.consistency, stars: 2.5 },
            },
        }).success,
    ).toBe(false)
})

test('content analysis rejects references outside saved notes, fallback findings and changed nonzero scores', () => {
    const resultWith = (contentAnalysis: unknown) =>
        analysisResultSchema.safeParse({ ...newReport, contentAnalysis }).success
    expect(
        resultWith({
            ...contentAnalysisFixture,
            weaknesses: [
                { ...contentAnalysisFixture.weaknesses[0], referenceIds: ['unknown-reference'] },
            ],
        }),
    ).toBe(false)
    expect(
        resultWith({
            ...fallbackContentAnalysisFixture,
            termRisks: contentAnalysisFixture.termRisks,
        }),
    ).toBe(false)
    expect(resultWith({ ...contentAnalysisFixture, originalScore: 8 })).toBe(false)
    expect(
        resultWith({
            ...contentAnalysisFixture,
            consistency: { ...contentAnalysisFixture.consistency, stars: 6 },
        }),
    ).toBe(false)
})

test('zero consistency report can retain unavailable original score and absent references', () => {
    const contentAnalysis = {
        ...contentAnalysisFixture,
        originalScore: null,
        consistency: { ...contentAnalysisFixture.consistency, stars: 0 },
        weaknesses: [],
    }
    const report = {
        ...newReport,
        contentAnalysis,
        insight: { ...checkupResult.insight, score: 0 },
        primaryScore: { source: 'insight', value: 0 },
        comparisonNotes: [],
    }
    const parsed = analysisResultSchema.parse(report)
    expect(parsed.contentAnalysis?.originalScore).toBeNull()
    expect(parsed.comparisonNotes).toEqual([])
    expect(readPrimaryScore(parsed).value).toBe(0)
    expect(
        analysisResultSchema.safeParse({
            ...newReport,
            contentAnalysis: { ...contentAnalysisFixture, originalScore: null },
        }).success,
    ).toBe(false)
    expect(analysisResultSchema.safeParse({ ...newReport, comparisonNotes: [] }).success).toBe(
        false,
    )
    expect(
        analysisResultSchema.safeParse({
            ...newReport,
            comparisonNotes: [],
            contentAnalysis: fallbackContentAnalysisFixture,
        }).success,
    ).toBe(false)
    expect(
        analysisResultSchema.safeParse({
            ...report,
            insight: null,
            primaryScore: { source: 'radar_average', value: 0 },
        }).success,
    ).toBe(false)
})
