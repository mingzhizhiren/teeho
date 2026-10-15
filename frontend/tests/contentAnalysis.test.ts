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

test('优化建议独立边界保留核心报告，缺省保持历史缺项，非法新增内容降级', () => {
    const item = {
        priority: 'high',
        location: 'body',
        sourceId: 'body:p2',
        evidence: '用户第二段原文',
        problem: '缺少判断标准',
        suggestion: '补充判断所需的具体条件。',
    }
    const complete = { status: 'completed', evidenceAvailability: 'limited', items: [item] }
    const invalidAdvice: unknown[] = [
        null,
        {},
        { status: 'unknown', items: [] },
        { ...complete, items: Array.from({ length: 6 }, () => ({ ...item })) },
        { ...complete, items: [{ ...item, evidence: '字'.repeat(501) }] },
        { ...complete, items: [{ ...item, problem: '字'.repeat(801) }] },
        { ...complete, items: [{ ...item, suggestion: '字'.repeat(801) }] },
        { ...complete, items: [{ ...item, sourceId: 'body:p0' }] },
        { ...complete, items: [{ ...item, sourceId: 'body:p01' }] },
        { ...complete, items: [{ ...item, sourceId: 'body:p9007199254740992' }] },
        {
            ...complete,
            items: [{ ...item, sourceId: 'topic:9007199254740992', location: 'topics' }],
        },
        { ...complete, items: [{ ...item, sourceId: 'topic:0', location: 'topics' }] },
        { ...complete, items: [{ ...item, sourceId: 'body:p' + '1'.repeat(75) }] },
        { ...complete, items: [{ ...item, sourceId: 'title' }] },
        { ...complete, items: [{ ...item, sourceId: 'material:uuid', location: 'content' }] },
        { status: 'unavailable', items: [item] },
        { ...complete, evidenceAvailability: 'unknown' },
        { ...complete, items: [{ ...item, evidence: '  ' }] },
        { ...complete, items: [{ ...item, priority: 'urgent' }] },
        { ...complete, items: [{ ...item, internalId: 'private-material-id' }] },
    ]
    for (const advice of invalidAdvice) {
        const parsed = analysisResultSchema.parse({
            ...newReport,
            contentAnalysis: { ...contentAnalysisFixture, advice },
        })
        expect(parsed.contentAnalysis?.advice).toEqual({ status: 'unavailable', items: [] })
        expect(readPrimaryScore(parsed).value).toBe(7)
        expect(parsed.contentAnalysis?.consistency).toEqual(contentAnalysisFixture.consistency)
    }
    expect(analysisResultSchema.parse(newReport).contentAnalysis?.advice).toBeUndefined()
    expect(
        analysisResultSchema.safeParse({
            ...newReport,
            contentAnalysis: {
                ...contentAnalysisFixture,
                advice: null,
                consistency: { ...contentAnalysisFixture.consistency, stars: 6 },
            },
        }).success,
    ).toBe(false)
    for (const count of [0, 1, 2, 3, 4, 5]) {
        const advice = { ...complete, items: Array.from({ length: count }, () => ({ ...item })) }
        const parsed = analysisResultSchema.parse({
            ...newReport,
            contentAnalysis: { ...contentAnalysisFixture, advice },
        })
        expect(parsed.contentAnalysis?.advice).toEqual(advice)
        expect(readPrimaryScore(parsed).value).toBe(7)
    }
})

test('新评价版本标记保留已保存星级和主分，不改旧报告并拒绝未知版本', () => {
    for (const [stars, value] of [
        [0, 0],
        [1, 2.1],
        [2, 4.2],
        [3, 7],
        [4, 7],
        [5, 7],
    ] as const) {
        const report = {
            ...newReport,
            insight: { ...checkupResult.insight, score: value },
            primaryScore: { source: 'insight', value },
            contentAnalysis: {
                ...contentAnalysisFixture,
                evaluationVersion: 'content-evaluation.v2',
                scorePolicy: 'consistency-weighted.v2',
                consistency: { ...contentAnalysisFixture.consistency, stars },
            },
        }
        const parsed = analysisResultSchema.parse(report)
        expect(readPrimaryScore(parsed).value).toBe(value)
        expect(parsed.contentAnalysis).toMatchObject({
            evaluationVersion: 'content-evaluation.v2',
            consistency: { stars },
        })
        expect(
            analysisResultSchema.safeParse({
                ...report,
                contentAnalysis: { ...report.contentAnalysis, evaluationVersion: 'unknown' },
            }).success,
        ).toBe(false)
    }
    expect(analysisResultSchema.parse(newReport).contentAnalysis).toEqual(contentAnalysisFixture)
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
