import { describe, expect, test } from 'bun:test'

import { analysisResultSchema } from '@/features/analysis/analysis.contract'
import {
    buildResultCopyText,
    copyResult,
    type ResultCopyLabels,
} from '@/features/analysis/resultDetails'
import { checkupResult } from './checkupResult.fixture'
import { contentAnalysisFixture, fallbackContentAnalysisFixture } from './contentAnalysis.fixture'

const labels: ResultCopyLabels = {
    contentAnalysis: {
        title: 'Content analysis',
        consistency: 'Consistency',
        risks: 'Wording risks',
        weaknesses: 'Shortcomings',
        noRisks: 'No wording risks',
        noWeaknesses: 'No supported shortcomings',
        fallback: 'Default 3 stars; analysis incomplete',
        scoreBlocked: 'Final score set to 0',
        references: 'References:',
        stars: (count) => `${count} / 5 stars`,
        locations: {
            title: 'Title',
            body: 'Body',
            topics: 'Topics',
            cover: 'Cover',
            content: 'Media',
        },
    },
    average: 'Radar average',
    metricUnavailable: 'Unavailable',
    insight: 'Insight',
    insightUnavailable: 'Unavailable',
    metrics: {
        topicDemand: 'Demand',
        titleExpression: 'Title',
        contentDevelopment: 'Content',
        readingExperience: 'Reading',
        interactionPotential: 'Interaction',
        distinctiveness: 'Distinctiveness',
    },
    referenceMean: 'Mean',
    referenceMedian: 'Median',
    referenceMax: 'Maximum',
    referenceMin: 'Minimum',
    referenceUnavailable: 'Unavailable',
    referenceRange: '80% range',
    missingUrl: 'Missing note address',
    likes: 'Likes',
    collects: 'Saves',
    comments: 'Comments',
    rapidGrowth: 'Growing rapidly',
    structureMetric: (name, value) => `${name}: ${value ?? '—'}`,
}

test('复制新报告使用冻结结构指标且不重复旧差异范围', () => {
    const result = analysisResultSchema.parse({
        ...checkupResult,
        structureMetrics: {
            titleLength: 9,
            titleEmojiRatio: 0,
            bodyLength: 145,
            paragraphLength: 72.5,
            listItemCount: null,
            topicCount: 2,
        },
    })
    const text = buildResultCopyText(result, {
        ...labels,
        structureMetric: (name, value) => `${name}: ${value ?? '—'}`,
    })
    expect(text).toContain('titleLength: 9')
    expect(text).toContain('titleEmojiRatio: 0')
    expect(text).toContain('listItemCount: —')
    expect(text).not.toContain('legacy comparison range')
})

describe('复制已完成的笔记体检报告', () => {
    test('omits one/two-star retention details from copied reports', () => {
        for (const [stars, value, percent] of [
            [1, 1.75, 25],
            [2, 3.5, 50],
        ]) {
            const contentAnalysis = {
                ...contentAnalysisFixture,
                scorePolicy: 'consistency-weighted.v1' as const,
                consistency: { ...contentAnalysisFixture.consistency, stars: stars! },
            }
            const text = buildResultCopyText(
                {
                    ...checkupResult,
                    insight: { ...checkupResult.insight!, score: value! },
                    contentAnalysis,
                },
                labels,
            )
            expect(text).not.toContain(`Final score retains ${percent}% of original`)
        }
        expect(
            buildResultCopyText(
                { ...checkupResult, contentAnalysis: contentAnalysisFixture },
                labels,
            ),
        ).not.toContain('Final score retains')
    })
    test('copies content analysis before differences and keeps evidence and reference titles', () => {
        const result = {
            ...checkupResult,
            contentAnalysis: contentAnalysisFixture,
            riskMatches: contentAnalysisFixture.termRisks,
            differences: [
                {
                    id: 'body',
                    metric: 'contentDevelopment' as const,
                    feature: 'bodyLength' as const,
                    value: 5,
                    low: 10,
                    high: 20,
                    severity: 'moderate' as const,
                    referenceIds: ['reference-1'],
                },
            ],
        }
        const copied = buildResultCopyText(result, labels)
        for (const value of [
            'Content analysis',
            '2 / 5 stars',
            '最佳',
            '对照笔记提供具体用量',
            'Comparable note',
        ])
            expect(copied).toContain(value)
        expect(copied.indexOf('Content analysis')).toBeLessThan(copied.indexOf('bodyLength'))
        expect(copied).not.toContain(result.qualitativeConclusion.summary)
    })
    test('fallback copy still includes independently matched vocabulary', () => {
        const copied = buildResultCopyText(
            {
                ...checkupResult,
                contentAnalysis: fallbackContentAnalysisFixture,
                riskMatches: contentAnalysisFixture.termRisks,
            },
            labels,
        )
        expect(copied).toContain('Default 3 stars; analysis incomplete')
        expect(copied).toContain('最佳')
        expect(copied.indexOf('Wording risks')).toBeLessThan(copied.lastIndexOf('Comparable note'))
        expect(copied).not.toContain('No supported shortcomings')
    })
    test('新报告保留赛道权重和模型身份，不复制加权参照说明', async () => {
        const reference = {
            trackCode: 1,
            sampleCount: 25,
            mean: 5,
            median: 5,
            min: 2,
            max: 8,
            p10: 3,
            p90: 7,
        }
        const result = analysisResultSchema.parse({
            ...checkupResult,
            insight: {
                ...checkupResult.insight,
                modelId: 'model-version',
                scoringMode: 'track_conditioned',
                tracks: [
                    { trackCode: 1, weight: 0.6, score: 7 },
                    { trackCode: 2, weight: 0.4, score: 7 },
                ],
                reference: {
                    ...reference,
                    aggregation: 'weighted_tracks',
                    components: [
                        { ...reference, weight: 0.6 },
                        { ...reference, trackCode: 2, weight: 0.4 },
                    ],
                },
            },
        })
        expect(result.insight?.tracks).toHaveLength(2)
        expect(result.insight?.modelId).toBe('model-version')
        let copied = ''
        await copyResult(result, labels, {
            writeText: async (text) => {
                copied = text
            },
        })
        expect(copied).toContain('Median: 5.00')
        expect(copied).not.toContain('Track-weighted references')
    })
    test('洞察主分复制真实极值，中位数与分位数区分', async () => {
        let copied = ''
        const result = analysisResultSchema.parse({
            ...checkupResult,
            insight: {
                status: 'available',
                score: 7,
                limited: false,
                comparison: null,
                reference: {
                    trackCode: 1,
                    sampleCount: 20,
                    mean: 5,
                    median: 4.86,
                    min: 1.23,
                    max: 9.87,
                    p10: 2.57,
                    p90: 7.42,
                },
            },
        })
        await copyResult(result, labels, {
            writeText: async (text) => {
                copied = text
            },
        })
        expect(copied).toContain('Median: 4.86')
        expect(copied).toContain('Maximum: 9.87')
        expect(copied).toContain('Minimum: 1.23')
        expect(copied).not.toContain('80% range:')
    })
    test('自定义指标使用保存的原文和顺序，缺失不显示零', async () => {
        let copied = ''
        const metadata = {
            description: 'saved description',
            unit: '元',
            metricVersion: '1',
            evidenceVersion: 'test',
            asOf: '2026-09-02T00:00:00.000Z',
        }
        await copyResult(
            analysisResultSchema.parse({
                ...checkupResult,
                schemaVersion: 'analysis-result.v7',
                primaryScore: { source: 'insight', value: 7 },
                customMetrics: [
                    {
                        ...metadata,
                        id: 'price',
                        name: 'Saved Price',
                        value: 0,
                        status: 'available',
                    },
                    {
                        ...metadata,
                        id: 'other',
                        name: 'Nouveau',
                        value: null,
                        status: 'unavailable',
                    },
                ],
            }),
            labels,
            {
                writeText: async (text) => {
                    copied = text
                },
            },
        )
        expect(copied).toContain('Saved Price: 0 元')
        expect(copied).toContain('Nouveau: Unavailable')
        expect(copied.indexOf('Saved Price')).toBeLessThan(copied.indexOf('Nouveau'))
    })
    test('平均分报告只显示保存的平均分来源，不生成模型参照', async () => {
        let copied = ''
        await copyResult(
            analysisResultSchema.parse({
                ...checkupResult,
                schemaVersion: 'analysis-result.v7',
                insight: null,
                radar: {
                    topicDemand: 8,
                    titleExpression: 6,
                    contentDevelopment: 7,
                    readingExperience: 9,
                    interactionPotential: null,
                    distinctiveness: null,
                },
                primaryScore: { source: 'radar_average', value: 7.5 },
            }),
            labels,
            {
                writeText: async (value) => {
                    copied = value
                },
            },
        )
        expect(copied).toContain('Radar average: 7.50')
        expect(copied).not.toContain('Insight:')
        expect(copied).not.toContain('4/6')
    })
    test('复制报告包含保存的洞察引擎主分', async () => {
        let text = ''
        await copyResult(
            analysisResultSchema.parse({
                ...checkupResult,
                insight: { status: 'available', score: 8.25, limited: false },
            }),
            labels,
            {
                writeText: async (value) => {
                    text = value
                },
            },
        )
        expect(text).toContain('Insight: 8.25')
    })
    test('复制分数、冻结结论与具体风险，不复制生成方案', async () => {
        let copiedText = ''
        await copyResult(analysisResultSchema.parse(checkupResult), labels, {
            async writeText(text: string): Promise<void> {
                copiedText = text
            },
        })
        expect(copiedText).toContain('Insight: 7.00 / 10')
        for (const label of Object.values(labels.metrics)) {
            expect(copiedText).not.toContain(`${label}:`)
        }
        expect(copiedText).toContain('Comparable note')
        expect(copiedText).toContain('Missing note address')
        expect(copiedText).not.toContain('L4')
        expect(copiedText.startsWith('Insight: 7.00 / 10')).toBe(true)
        expect(copiedText).not.toContain('bestContentPlan')
    })

    test('剪贴板失败向界面返回失败，不能宣称已经复制', async () => {
        await expect(
            copyResult(analysisResultSchema.parse(checkupResult), labels, {
                async writeText(): Promise<void> {
                    throw new Error('clipboard_denied')
                },
            }),
        ).rejects.toThrow('clipboard_denied')
    })
})
