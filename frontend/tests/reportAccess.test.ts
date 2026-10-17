import { expect, test } from 'bun:test'
import { analysisResultSchema } from '@/features/analysis/analysis.contract'
import { fullAnalysisResultSchema } from '@/features/analysis/analysis.checkup-contract'
import {
    hasFullReportAccess,
    reportAccessSchema,
    canShowContentIndicator,
    canShowReportSection,
    canShowStructureMetric,
} from '@/features/analysis/analysis.report-access'
import { buildResultCopyText, type ResultCopyLabels } from '@/features/analysis/resultDetails'
import { checkupResult } from './checkupResult.fixture'
import {
    tierReport,
    fullReportAccess,
    restrictedReport,
    paidReport,
    freeReport,
    currentAnonymousReport,
} from './reportAccess.fixture'

const labels: ResultCopyLabels = {
    contentAnalysis: {
        title: '内容分析',
        consistency: '内容一致性',
        risks: '高风险词汇',
        weaknesses: '同类不足',
        noRisks: '未发现风险',
        riskResultsMissing: '未提供风险检测结果。',
        noWeaknesses: '没有不足',
        noObviousWeaknesses: '没有明显不足',
        advice: {
            title: '问题与优化建议',
            empty: '没有建议',
            unavailable: '建议不可用',
            problem: '问题',
            location: '位置',
            evidence: '依据',
            suggestion: '建议',
            priorities: { high: '高', medium: '中', low: '低' },
            titleLocation: '标题',
            coverLocation: '封面',
            contentLocation: '素材',
            paragraphLocation: (n) => `段落${n}`,
            topicLocation: (n) => `话题${n}`,
        },
        fallback: '分析不可用',
        scoreBlocked: '零分',
        references: '参考',
        stars: (n) => `${n}星`,
        locations: { title: '标题', body: '正文', topics: '话题', cover: '封面', content: '内容' },
    },
    average: '平均分',
    metricUnavailable: '不可用',
    insight: '洞察分',
    insightUnavailable: '不可用',
    metrics: {
        topicDemand: '',
        titleExpression: '',
        contentDevelopment: '',
        readingExperience: '',
        interactionPotential: '',
        distinctiveness: '',
    },
    referenceMean: '',
    referenceMedian: '',
    referenceRange: '',
    referenceMax: '',
    referenceMin: '',
    referenceUnavailable: '',
    missingUrl: '无地址',
    likes: '赞',
    collects: '藏',
    comments: '评',
    rapidGrowth: '增长',
    structureMetric: (name, value) => `${name}: ${value}`,
}

test('匿名报告读取、复制仅包含已授予指标及一篇参考，保留登录文案', () => {
    const parsed = analysisResultSchema.parse(restrictedReport)
    expect(parsed.structureMetrics.paragraphLength).toBeUndefined()
    expect(parsed.contentAnalysis?.advice).toBeUndefined()
    expect(parsed.comparisonNotes).toHaveLength(1)
    const text = buildResultCopyText(parsed, labels)
    for (const hidden of [
        'paragraphLength:',
        'topicLength:',
        'imageCount:',
        'videoDurationSeconds:',
        '问题与优化建议',
    ])
        expect(text).not.toContain(hidden)
    expect(text).toContain('titleLength: 9')
    expect(text).toContain('内容一致性')
    expect(text).toContain('高风险词汇')
    expect(text.endsWith(restrictedReport.reportAccess.footer!)).toBe(true)
})

test('匿名裁剪保留后端风险数组；关闭风险权限时拒绝任何 canonical 风险载荷', () => {
    const riskMatches = [
        {
            ...restrictedReport.contentAnalysis.termRisks[0]!,
            term: 'server-canonical-risk',
            riskLevel: 'low' as const,
        },
    ]
    const parsed = analysisResultSchema.parse({
        ...restrictedReport,
        contentAnalysis: { ...restrictedReport.contentAnalysis, termRisks: [] },
        riskMatches,
    })
    expect(parsed.riskMatches).toEqual(riskMatches)
    expect(buildResultCopyText(parsed, labels)).toContain('server-canonical-risk')
    const contentAccess = restrictedReport.reportAccess.sections.contentAnalysis
    const reportAccess = {
        ...restrictedReport.reportAccess,
        sections: {
            ...restrictedReport.reportAccess.sections,
            contentAnalysis: {
                ...contentAccess,
                indicators: { ...contentAccess.indicators, termRisks: false },
            },
        },
    }
    const hidden = {
        ...restrictedReport,
        reportAccess,
        contentAnalysis: { ...restrictedReport.contentAnalysis, termRisks: undefined },
    }
    expect(analysisResultSchema.safeParse(hidden).success).toBe(true)
    expect(analysisResultSchema.safeParse({ ...hidden, riskMatches }).success).toBe(false)
    expect(analysisResultSchema.safeParse({ ...hidden, riskMatches: [] }).success).toBe(false)
})

test('拒绝隐藏字段、重复内部载荷、超额参考和越权引用', () => {
    const invalid = [
        {
            ...restrictedReport,
            structureMetrics: { ...restrictedReport.structureMetrics, paragraphLength: 30 },
        },
        {
            ...restrictedReport,
            structureReferences: { ...restrictedReport.structureReferences, imageCount: null },
        },
        {
            ...restrictedReport,
            contentAnalysis: {
                ...restrictedReport.contentAnalysis,
                advice: { status: 'completed', items: [] },
            },
        },
        {
            ...restrictedReport,
            contentAnalysis: {
                ...restrictedReport.contentAnalysis,
                weaknesses: [
                    { ...restrictedReport.contentAnalysis.weaknesses[0], suggestion: '隐藏建议' },
                ],
            },
        },
        {
            ...restrictedReport,
            comparisonNotes: [
                ...restrictedReport.comparisonNotes,
                { ...restrictedReport.comparisonNotes[0], noteId: 'hidden-note' },
            ],
        },
        {
            ...restrictedReport,
            contentAnalysis: {
                ...restrictedReport.contentAnalysis,
                weaknesses: [
                    {
                        ...restrictedReport.contentAnalysis.weaknesses[0],
                        referenceIds: ['hidden-note'],
                    },
                ],
            },
        },
        { ...restrictedReport, radar: checkupResult.radar },
        { ...restrictedReport, qualitativeConclusion: { summary: '隐藏建议副本' } },
        { ...restrictedReport, noteScoringCoefficient: 1 },
        { ...restrictedReport, reportAccess: undefined },
        { ...restrictedReport, reportAccess: fullReportAccess },
    ]
    for (const value of invalid) expect(analysisResultSchema.safeParse(value).success).toBe(false)
})

test('整个结果项关闭时不复制标题、空态或隐藏风险，也不重新生成结果', () => {
    const access = {
        ...restrictedReport.reportAccess,
        sections: {
            contentAnalysis: {
                ...restrictedReport.reportAccess.sections.contentAnalysis,
                enabled: false,
            },
            structureMetrics: {
                ...restrictedReport.reportAccess.sections.structureMetrics,
                enabled: false,
            },
            comparisonNotes: { enabled: false, limit: 0 },
        },
        footer: null,
    }
    const parsed = analysisResultSchema.parse({
        ...restrictedReport,
        reportAccess: access,
        contentAnalysis: undefined,
        structureMetrics: {},
        structureReferences: {},
        comparisonNotes: [],
    })
    const text = buildResultCopyText(parsed, labels)
    for (const hidden of [
        '内容分析',
        '内容一致性',
        '高风险词汇',
        '没有不足',
        'titleLength',
        'Comparable note',
        '最佳',
    ])
        expect(text).not.toContain(hidden)
    expect(canShowReportSection(access, 'contentAnalysis')).toBe(false)
    expect(canShowContentIndicator(access, 'termRisks')).toBe(false)
    expect(canShowStructureMetric(access, 'titleLength')).toBe(false)
})

test('完整与无权限标记的历史报告仍经过严格评分校验，不裁剪或补算', () => {
    expect(analysisResultSchema.parse(checkupResult)).toEqual(
        fullAnalysisResultSchema.parse(checkupResult),
    )
    expect(
        analysisResultSchema.parse({ ...checkupResult, reportAccess: fullReportAccess })
            .comparisonNotes,
    ).toEqual(checkupResult.comparisonNotes)
    const invalid = {
        ...checkupResult,
        reportAccess: fullReportAccess,
        primaryScore: { source: 'insight', value: 0 },
    }
    expect(analysisResultSchema.safeParse(invalid).success).toBe(false)
    expect(fullAnalysisResultSchema.safeParse(restrictedReport).success).toBe(false)
})

test('新版付费八篇、免费四篇、匿名一篇在读取与复制时分别保持数量', () => {
    for (const [fixture, count] of [
        [paidReport, 8],
        [freeReport, 4],
        [currentAnonymousReport, 1],
    ] as const) {
        const report = analysisResultSchema.parse(fixture)
        expect(report.comparisonNotes).toHaveLength(count)
        const text = buildResultCopyText(report, labels)
        expect(text.match(/^Tier comparison \d+$/gmu)).toHaveLength(count)
        expect(text).toContain(`Tier comparison ${count}`)
        expect(text).not.toContain(`Tier comparison ${count + 1}`)
    }
    expect(
        analysisResultSchema.safeParse({
            ...freeReport,
            comparisonNotes: paidReport.comparisonNotes,
        }).success,
    ).toBe(false)
    expect(
        analysisResultSchema.safeParse({
            ...currentAnonymousReport,
            comparisonNotes: freeReport.comparisonNotes,
        }).success,
    ).toBe(false)
})

test('旧 v1 四篇完整权限继续可读，不能通过旧标记接收八篇或新版八篇上限外数据', () => {
    const historical = {
        ...paidReport,
        reportAccess: fullReportAccess,
        comparisonNotes: paidReport.comparisonNotes.slice(0, 4),
    }
    expect(analysisResultSchema.parse(historical).comparisonNotes).toHaveLength(4)
    expect(
        analysisResultSchema.safeParse({ ...paidReport, reportAccess: fullReportAccess }).success,
    ).toBe(false)
    expect(
        analysisResultSchema.safeParse({
            ...paidReport,
            reportAccess: { ...paidReport.reportAccess, version: 'report-access.v1' },
        }).success,
    ).toBe(false)
    expect(
        analysisResultSchema.safeParse({
            ...paidReport,
            comparisonNotes: [
                ...paidReport.comparisonNotes,
                { ...paidReport.comparisonNotes[0], noteId: 'reference-9' },
            ],
        }).success,
    ).toBe(false)
})

test('v3 免费四篇、Coffee 八篇与 Plus 十篇展示和复制遵守冻结配额', () => {
    for (const count of [4, 8, 10] as const) {
        const report = analysisResultSchema.parse(tierReport(count))
        expect(report.comparisonNotes).toHaveLength(count)
        expect(buildResultCopyText(report, labels).match(/^Tier comparison \d+$/gmu)).toHaveLength(
            count,
        )
        expect(
            analysisResultSchema.safeParse({
                ...tierReport(count),
                comparisonNotes: [
                    ...tierReport(count).comparisonNotes,
                    { ...paidReport.comparisonNotes[0], noteId: 'overflow' },
                ],
            }).success,
        ).toBe(false)
    }
})

test('各代协议保留完整报告语义并拒绝越界权限', () => {
    for (const [version, limit] of [
        ['report-access.v1', 4],
        ['report-access.v2', 8],
        ['report-access.v3', 10],
    ] as const) {
        const access = {
            ...tierReport(10).reportAccess,
            version,
            sections: { ...fullReportAccess.sections, comparisonNotes: { enabled: true, limit } },
        }
        expect(hasFullReportAccess(reportAccessSchema.parse(access))).toBe(true)
        expect(
            reportAccessSchema.safeParse({
                ...access,
                sections: {
                    ...access.sections,
                    comparisonNotes: { enabled: true, limit: limit + 1 },
                },
            }).success,
        ).toBe(false)
    }
    expect(hasFullReportAccess(tierReport(8).reportAccess)).toBe(false)
})
