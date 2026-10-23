import { expect, test } from 'bun:test'
import { analysisResultSchema } from '@/features/analysis/analysis.contract'
import { expectedContentScore } from '@/features/analysis/analysis.content-analysis'
import { structureMetricNames } from '@/features/analysis/analysis.structure-metrics'
import { checkupResult } from './checkupResult.fixture'
import { contentAnalysisFixture } from './contentAnalysis.fixture'

const applicable = structureMetricNames.filter((metric) => metric !== 'videoDurationSeconds')
const noteScoringAudit = {
    policy: 'structure-coefficient.v1',
    contentKind: 'image',
    reviewCompleted: true,
    evaluated: applicable.map((metric) => ({ metric, severity: 'aligned', contribution: 0.5 / 9 })),
    unavailable: [],
    notApplicable: ['videoDurationSeconds'],
}
const report = {
    ...checkupResult,
    schemaVersion: 'analysis-result.v7',
    primaryScore: { source: 'insight', value: 8.72 },
    insight: { ...checkupResult.insight, score: 8.72 },
    noteScoringCoefficient: 1.05,
    noteScoringAudit,
    structureMetrics: Object.fromEntries(
        structureMetricNames.map((metric) => [
            metric,
            metric === 'videoDurationSeconds' ? null : 10,
        ]),
    ),
    structureReferences: Object.fromEntries(
        structureMetricNames.map((metric) => [
            metric,
            metric === 'videoDurationSeconds'
                ? null
                : { low: 10, high: 10, severity: 'aligned', sampleCount: 20 },
        ]),
    ),
    contentAnalysis: {
        ...contentAnalysisFixture,
        originalScore: 8.3,
        scorePolicy: 'consistency-weighted.v2',
        consistency: { ...contentAnalysisFixture.consistency, stars: 5 },
    },
}

test('读取 v1 历史报告的最终分及冻结系数，保留独立星级倍率', () => {
    for (const [stars, score] of [
        [0, 0],
        [1, 2.61],
        [2, 5.23],
        [3, 8.72],
        [4, 8.72],
        [5, 8.72],
    ] as const) {
        const current = {
            ...report,
            primaryScore: { source: 'insight', value: score },
            insight: { ...report.insight, score },
            contentAnalysis: {
                ...report.contentAnalysis,
                consistency: { ...report.contentAnalysis.consistency, stars },
            },
        }
        const parsed = analysisResultSchema.parse(current)
        expect(parsed.primaryScore?.value).toBe(score)
        expect(parsed.noteScoringCoefficient).toBe(1.05)
        expect(parsed.noteScoringAudit).toEqual(noteScoringAudit)
    }
})

test('v2 结构系数范围 0.5～1，仅五星追加 0.05，拒绝四星冒领奖励', () => {
    for (const [stars, coefficient, score] of [
        [0, 1, 0],
        [1, 1, 2.49],
        [2, 1, 4.98],
        [3, 1, 8.3],
        [4, 1, 8.3],
        [5, 1.05, 8.72],
    ] as const) {
        const current = {
            ...report,
            noteScoringCoefficient: coefficient,
            noteScoringAudit: { ...noteScoringAudit, policy: 'structure-coefficient.v2' },
            primaryScore: { source: 'insight', value: score },
            insight: { ...report.insight, score },
            contentAnalysis: {
                ...report.contentAnalysis,
                consistency: { ...report.contentAnalysis.consistency, stars },
            },
        }
        expect(analysisResultSchema.parse(current).primaryScore?.value).toBe(score)
        expect(
            analysisResultSchema.safeParse({
                ...current,
                noteScoringCoefficient: coefficient + 0.05,
            }).success,
        ).toBe(false)
    }
    for (const [stars, coefficient, score] of [
        [4, 0.5, 4.15],
        [5, 0.55, 4.57],
    ] as const) {
        const current = {
            ...report,
            noteScoringCoefficient: coefficient,
            noteScoringAudit: {
                ...noteScoringAudit,
                policy: 'structure-coefficient.v2',
                evaluated: applicable.map((metric) => ({
                    metric,
                    severity: 'critical',
                    contribution: 0,
                })),
            },
            structureReferences: Object.fromEntries(
                structureMetricNames.map((metric) => [
                    metric,
                    metric === 'videoDurationSeconds'
                        ? null
                        : { low: 100, high: 100, severity: 'critical', sampleCount: 20 },
                ]),
            ),
            primaryScore: { source: 'insight', value: score },
            insight: { ...report.insight, score },
            contentAnalysis: {
                ...report.contentAnalysis,
                consistency: { ...report.contentAnalysis.consistency, stars },
            },
        }
        expect(analysisResultSchema.parse(current).noteScoringCoefficient).toBe(coefficient)
    }
})

test('最终分乘完结构和星级倍率后统一舍入，并限制最高 10 分', () => {
    const parsed = analysisResultSchema.parse(report)
    const analysis = parsed.contentAnalysis!
    expect(
        expectedContentScore(
            {
                ...analysis,
                originalScore: 8.3049,
                consistency: { ...analysis.consistency, stars: 1 },
            },
            1.05,
        ),
    ).toBe(2.62)
    expect(expectedContentScore({ ...analysis, originalScore: 9.99 }, 1.05)).toBe(10)
})

test('缺项、评审未完成和明细不一致均不能伪造奖励或新主分', () => {
    for (const invalid of [
        { ...report, noteScoringAudit: undefined },
        { ...report, noteScoringCoefficient: undefined },
        { ...report, noteScoringCoefficient: 1.1 },
        { ...report, contentAnalysis: { ...report.contentAnalysis, scorePolicy: undefined } },
        { ...report, noteScoringAudit: { ...noteScoringAudit, reviewCompleted: false } },
        { ...report, noteScoringAudit: { ...noteScoringAudit, notApplicable: ['imageCount'] } },
        { ...report, structureReferences: { ...report.structureReferences, bodyLength: null } },
        {
            ...report,
            noteScoringAudit: {
                ...noteScoringAudit,
                evaluated: [...noteScoringAudit.evaluated, noteScoringAudit.evaluated[0]],
            },
        },
    ])
        expect(analysisResultSchema.safeParse(invalid).success).toBe(false)
})

test('已保存旧报告不补写系数，也不根据现在的结构范围改分', () => {
    const parsed = analysisResultSchema.parse(checkupResult)
    expect(parsed.noteScoringCoefficient).toBeUndefined()
    expect(parsed.noteScoringAudit).toBeUndefined()
    expect(parsed.insight?.score).toBe(checkupResult.insight?.score)
})
