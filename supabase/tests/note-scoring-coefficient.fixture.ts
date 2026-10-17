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
