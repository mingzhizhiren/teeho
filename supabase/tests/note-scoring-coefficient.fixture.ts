const metricNames = [
    'titleLength',
    'bodyLength',
    'paragraphLength',
    'paragraphCount',
    'topicCount',
    'topicLength',
    'maxTopicLength',
    'maxParagraphLength',
    'imageCount',
] as const

/** 独立数据库合成报告，不加载服务端、真实模型或用户数据。 */
export function noteCoefficientReport(stars = 5, original = 8.3, score = 8.72) {
    return {
        schemaVersion: 'analysis-result.v7',
        referenceRequirement: 'optional',
        primaryTrack: 1,
        primaryScore: { source: 'insight', value: score },
        insight: { status: 'available', score, limited: false, reference: null, comparison: null },
        radar: {
            topicDemand: original,
            titleExpression: original,
            contentDevelopment: original,
            readingExperience: original,
            interactionPotential: original,
            distinctiveness: original,
        },
        differences: [],
        qualitativeConclusion: { summary: '合成内容检查结果。' },
        comparisonNotes: [],
        topicSupport: { status: 'no_sources', matchedTopics: [], bonus: 0 },
        contentAnalysis: {
            status: 'completed',
            scorePolicy: 'consistency-weighted.v2',
            originalScore: original,
            consistency: {
                stars,
                summary: '已检查一致性。',
                issues:
                    stars === 0
                        ? [{ location: 'title', evidence: '标题', description: '主题不一致。' }]
                        : [],
            },
            termRisks: [],
            weaknesses: [],
        },
        structureMetrics: {
            ...Object.fromEntries(metricNames.map((name) => [name, 10])),
            videoDurationSeconds: null,
        },
        structureReferences: {
            ...Object.fromEntries(
                metricNames.map((name) => [
                    name,
                    { low: 10, high: 10, severity: 'aligned', sampleCount: 20 },
                ]),
            ),
            videoDurationSeconds: null,
        },
        noteScoringCoefficient: 1.05,
        noteScoringAudit: {
            policy: 'structure-coefficient.v1',
            contentKind: 'image',
            reviewCompleted: true,
            evaluated: metricNames.map((metric) => ({
                metric,
                severity: 'aligned',
                contribution: 0.5 / 9,
            })),
            unavailable: [],
            notApplicable: ['videoDurationSeconds'],
        },
    }
}

/** v2 合成报告：结构区间改为 0.5～1，五星独立奖励 0.05。 */
export function fiveStarCoefficientReport(
    stars = 4,
    critical = false,
): ReturnType<typeof noteCoefficientReport> {
    const coefficient = (critical ? 0.5 : 1) + (stars === 5 ? 0.05 : 0)
    const multiplier = [0, 0.3, 0.6, 1, 1, 1][stars]!
    const score = Math.round(Number((8.3 * coefficient * multiplier).toFixed(12)) * 100) / 100
    const base = noteCoefficientReport(stars, 8.3, score)
    const severity = critical ? 'critical' : 'aligned'
    return {
        ...base,
        noteScoringCoefficient: coefficient,
        structureReferences: {
            ...Object.fromEntries(
                metricNames.map((metric) => [
                    metric,
                    {
                        low: critical ? 100 : 10,
                        high: critical ? 100 : 10,
                        severity,
                        sampleCount: 20,
                    },
                ]),
            ),
            videoDurationSeconds: null,
        },
        noteScoringAudit: {
            ...base.noteScoringAudit,
            policy: 'structure-coefficient.v2',
            evaluated: metricNames.map((metric) => ({
                metric,
                severity,
                contribution: critical ? 0 : 0.5 / 9,
            })),
        },
    }
}
