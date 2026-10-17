import { describe, expect, it } from 'vitest'
import { checkupReportSchema, type CheckupReport } from '../checkup/analysis.checkup.contract'
import { calculateNoteScoring } from '../checkup/analysis.note-scoring'
import { compareStructureMetrics } from '../checkup/analysis.structure-metrics'
import {
    ANONYMOUS_SKILL_REPORT_ACCESS,
    FULL_REPORT_ACCESS,
    isFullReportAccess,
    reportAccessPolicySchema,
    type ReportAccessPolicy,
} from './analysis.report-access.policy'

it('权限 v1 保留四篇历史语义，v2 支持八篇且免费四篇只裁剪对照范围', () => {
    const report = fixture()
    const eight = checkupReportSchema.parse({
        ...report,
        comparisonNotes: Array.from({ length: 8 }, (_, index) => ({
            ...report.comparisonNotes[0],
            noteId: `note-${index + 1}`,
        })),
    })
    const legacy = reportAccessPolicySchema.parse({
        ...FULL_REPORT_ACCESS,
        version: 'report-access.v1',
        sections: { ...FULL_REPORT_ACCESS.sections, comparisonNotes: { enabled: true, limit: 4 } },
    })
    expect(isFullReportAccess(legacy)).toBe(true)
    expect(projectCheckupReport(report, legacy).comparisonNotes).toHaveLength(4)
    expect(() => projectCheckupReport(eight, legacy)).toThrow()
    const free = reportAccessPolicySchema.parse({ ...legacy, version: 'report-access.v2' })
    const delivered = projectCheckupReport(eight, free)
    expect(delivered.comparisonNotes).toHaveLength(4)
    expect(delivered.contentAnalysis?.advice).toEqual(eight.contentAnalysis?.advice)
    expect(delivered.structureMetrics).toEqual(eight.structureMetrics)
    expect(projectCheckupReport(eight, FULL_REPORT_ACCESS).comparisonNotes).toHaveLength(8)
    expect(
        reportAccessPolicySchema.safeParse({ ...FULL_REPORT_ACCESS, version: 'report-access.v1' })
            .success,
    ).toBe(false)
})
it('v3 按 4/8/10 裁剪且保留 v2 八篇历史语义，拒绝越界版本', () => {
    const base = fixture()
    const ten = checkupReportSchema.parse({
        ...base,
        comparisonNotes: Array.from({ length: 10 }, (_, index) => ({
            ...base.comparisonNotes[0],
            noteId: `note-${index + 1}`,
        })),
    })
    for (const limit of [4, 8, 10]) {
        const access = reportAccessPolicySchema.parse({
            ...FULL_REPORT_ACCESS,
            sections: { ...FULL_REPORT_ACCESS.sections, comparisonNotes: { enabled: true, limit } },
        })
        const delivered = projectCheckupReport(ten, access)
        expect(delivered.comparisonNotes).toEqual(ten.comparisonNotes.slice(0, limit))
        expect(delivered.contentAnalysis?.advice).toEqual(ten.contentAnalysis?.advice)
    }
    const v2 = reportAccessPolicySchema.parse({
        ...FULL_REPORT_ACCESS,
        version: 'report-access.v2',
        sections: { ...FULL_REPORT_ACCESS.sections, comparisonNotes: { enabled: true, limit: 8 } },
    })
    expect(isFullReportAccess(v2)).toBe(true)
    expect(
        projectCheckupReport({ ...ten, comparisonNotes: ten.comparisonNotes.slice(0, 8) }, v2)
            .comparisonNotes,
    ).toHaveLength(8)
    expect(() => projectCheckupReport(ten, v2)).toThrow()
    for (const [version, limit] of [
        ['report-access.v1', 5],
        ['report-access.v2', 9],
        ['report-access.v3', 11],
    ]) {
        expect(
            reportAccessPolicySchema.safeParse({
                ...FULL_REPORT_ACCESS,
                version,
                sections: {
                    ...FULL_REPORT_ACCESS.sections,
                    comparisonNotes: { enabled: true, limit },
                },
            }).success,
        ).toBe(false)
    }
})

import {
    projectCheckupReport,
    projectedCheckupReportSchema,
} from './analysis.report-access.projection'
import {
    CONTENT_ANALYSIS_INDICATORS,
    STRUCTURE_METRIC_INDICATORS,
} from './analysis.report-access.registry'

function fixture(): CheckupReport {
    const structureMetrics = {
        titleLength: 10,
        bodyLength: 100,
        paragraphLength: 25,
        paragraphCount: 4,
        topicCount: 2,
        topicLength: 5,
        maxTopicLength: 6,
        maxParagraphLength: 30,
        imageCount: 3,
        videoDurationSeconds: null,
    }
    const structureReferences = compareStructureMetrics(
        structureMetrics,
        Array(4).fill(structureMetrics),
    )
    return checkupReportSchema.parse({
        schemaVersion: 'analysis-result.v7',
        primaryTrack: 1,
        primaryScore: { source: 'insight', value: 8.4 },
        insight: {
            status: 'available',
            score: 8.4,
            limited: false,
            reference: null,
            comparison: null,
        },
        radar: {
            topicDemand: 8,
            titleExpression: 8,
            contentDevelopment: 8,
            readingExperience: 8,
            interactionPotential: 8,
            distinctiveness: 8,
        },
        differences: [
            {
                id: 'paragraphLength',
                metric: 'readingExperience',
                feature: 'paragraphLength',
                value: 25,
                low: 25,
                high: 25,
                severity: 'aligned',
                referenceIds: ['note-2'],
            },
        ],
        qualitativeConclusion: { summary: '隐藏建议的历史摘要副本' },
        topicSupport: { status: 'no_sources', matchedTopics: [], bonus: 0 },
        comparisonNotes: Array.from({ length: 4 }, (_, index) => ({
            noteId: `note-${index + 1}`,
            title: `参考标题${index + 1}`,
            bodyExcerpt: `参考正文${index + 1}`,
            likes: 100,
            collects: 30,
            comments: 10,
            url: null,
            reason: '同类优秀笔记',
        })),
        contentAnalysis: {
            status: 'completed',
            scorePolicy: 'consistency-weighted.v2',
            originalScore: 8,
            consistency: { stars: 5, summary: '主题一致', issues: [] },
            advice: {
                status: 'completed',
                evidenceAvailability: 'sufficient',
                items: [
                    {
                        priority: 'medium',
                        location: 'title',
                        sourceId: 'title',
                        evidence: '咖啡',
                        problem: '专属问题详情',
                        suggestion: '专属修改方向',
                    },
                ],
            },
            termRisks: [
                {
                    location: 'body',
                    evidence: '风险词',
                    description: '谨慎表达',
                    term: '风险词',
                    category: '夸大',
                },
            ],
            weaknesses: [
                {
                    location: 'title',
                    evidence: '咖啡',
                    description: '保留对照的差异',
                    suggestion: '独立建议的副本',
                    referenceIds: ['note-1'],
                },
                {
                    location: 'body',
                    evidence: '正文',
                    description: '参考正文2的差异',
                    referenceIds: ['note-1', 'note-2'],
                },
            ],
        },
        riskMatches: [
            {
                location: 'body',
                evidence: '备用风险',
                description: '历史备用字段',
                term: '备用风险',
                category: '风险',
            },
        ],
        riskReviewStatus: 'completed',
        structureMetricsVersion: 'structure.v3',
        structureMetrics,
        structureReferences,
        structureLocations: {
            topics: [{ index: 0, text: '最长话题' }],
            paragraphs: [{ index: 0, number: 1, text: '最长段落' }],
        },
        ...calculateNoteScoring('image', structureMetrics, structureReferences, true),
    })
}

function disableContent(key: keyof typeof CONTENT_ANALYSIS_INDICATORS): ReportAccessPolicy {
    const current = FULL_REPORT_ACCESS.sections.contentAnalysis
    return {
        ...FULL_REPORT_ACCESS,
        sections: {
            ...FULL_REPORT_ACCESS.sections,
            contentAnalysis: { ...current, indicators: { ...current.indicators, [key]: false } },
        },
    }
}

describe('报告权限交付', () => {
    it('完整权限保留保存的分数、内容和旧契约，不修改源对象', () => {
        const saved = fixture()
        const before = JSON.stringify(saved)
        const { reportAccess, ...full } = projectCheckupReport(saved, FULL_REPORT_ACCESS)
        expect(reportAccess).toEqual(FULL_REPORT_ACCESS)
        expect(full).toEqual(saved)
        expect(checkupReportSchema.safeParse(full).success).toBe(true)
        expect(JSON.stringify(saved)).toBe(before)
    })

    it('匿名只交付一篇笔记、六项结构及已开放内容，不从备用字段泄漏', () => {
        const saved = fixture()
        const projected = projectCheckupReport(saved, ANONYMOUS_SKILL_REPORT_ACCESS)
        expect(projected.primaryScore).toEqual(saved.primaryScore)
        expect(projected.comparisonNotes.map((note) => note.noteId)).toEqual(['note-1'])
        expect(Object.keys(projected.structureMetrics)).toEqual([
            'titleLength',
            'bodyLength',
            'paragraphCount',
            'topicCount',
            'maxTopicLength',
            'maxParagraphLength',
        ])
        for (const key of [
            'paragraphLength',
            'topicLength',
            'imageCount',
            'videoDurationSeconds',
        ]) {
            expect(projected.structureMetrics).not.toHaveProperty(key)
            expect(projected.structureReferences).not.toHaveProperty(key)
        }
        expect(projected.contentAnalysis?.advice).toBeUndefined()
        expect(projected.contentAnalysis?.consistency).toEqual(saved.contentAnalysis?.consistency)
        expect(projected.contentAnalysis?.termRisks).toEqual(saved.contentAnalysis?.termRisks)
        expect(projected.riskMatches).toEqual(saved.riskMatches)
        expect(projected.contentAnalysis?.weaknesses).toEqual([
            {
                location: 'title',
                evidence: '咖啡',
                description: '保留对照的差异',
                referenceIds: ['note-1'],
            },
        ])
        for (const field of [
            'noteScoringAudit',
            'noteScoringCoefficient',
            'radar',
            'differences',
            'qualitativeConclusion',
            'topicSupport',
        ])
            expect(projected).not.toHaveProperty(field)
        expect(JSON.stringify(projected)).not.toMatch(
            /专属问题详情|专属修改方向|独立建议的副本|参考正文2|note-2/,
        )
        expect(projected.reportAccess.footer).toBe('🌐向agent发送：“登录题火”解锁显示更多诊断信息')
        expect(checkupReportSchema.safeParse(projected).success).toBe(false)
        expect(checkupReportSchema.safeParse(saved).success).toBe(true)
    })

    it('风险交付区分缺失与空结果，不从旧 termRisks 字段补造结论', () => {
        const saved = fixture()
        const { riskMatches: omitted, ...legacy } = saved
        expect(omitted?.length).toBeGreaterThan(0)
        const missing = projectCheckupReport(legacy, ANONYMOUS_SKILL_REPORT_ACCESS)
        expect(missing).not.toHaveProperty('riskMatches')
        const empty = projectCheckupReport(
            { ...saved, riskMatches: [] },
            ANONYMOUS_SKILL_REPORT_ACCESS,
        )
        expect(empty.riskMatches).toEqual([])
        const unreviewed = projectCheckupReport(
            { ...saved, riskReviewStatus: 'unavailable' },
            ANONYMOUS_SKILL_REPORT_ACCESS,
        )
        expect(unreviewed.riskMatches).toEqual(saved.riskMatches)
        expect(unreviewed.riskReviewStatus).toBe('unavailable')
    })

    it.each(
        Object.keys(CONTENT_ANALYSIS_INDICATORS) as (keyof typeof CONTENT_ANALYSIS_INDICATORS)[],
    )('内容指标 %s 可独立关闭', (key) => {
        const report = projectCheckupReport(fixture(), disableContent(key))
        expect(report.contentAnalysis).not.toHaveProperty(key)
        if (key === 'consistency') {
            expect(report.contentAnalysis).not.toHaveProperty('originalScore')
            expect(report.contentAnalysis).not.toHaveProperty('scorePolicy')
        }
        if (key === 'termRisks') {
            expect(report).not.toHaveProperty('riskReviewStatus')
            expect(report).not.toHaveProperty('riskMatches')
            expect(
                projectedCheckupReportSchema.safeParse({ ...report, riskMatches: [] }).success,
            ).toBe(false)
        }
    })

    it.each(
        Object.keys(STRUCTURE_METRIC_INDICATORS) as (keyof typeof STRUCTURE_METRIC_INDICATORS)[],
    )('结构指标 %s 的值和范围同时关闭', (key) => {
        const structure = FULL_REPORT_ACCESS.sections.structureMetrics
        const policy = {
            ...FULL_REPORT_ACCESS,
            sections: {
                ...FULL_REPORT_ACCESS.sections,
                structureMetrics: {
                    ...structure,
                    indicators: { ...structure.indicators, [key]: false },
                },
            },
        }
        const report = projectCheckupReport(fixture(), policy)
        expect(report.structureMetrics).not.toHaveProperty(key)
        expect(report.structureReferences).not.toHaveProperty(key)
        if (key === 'maxTopicLength') expect(report.structureLocations).not.toHaveProperty('topics')
        if (key === 'maxParagraphLength')
            expect(report.structureLocations).not.toHaveProperty('paragraphs')
    })

    it('关闭结果项时连同所有子项隐藏，评分不受展示权限影响', () => {
        const report = projectCheckupReport(fixture(), {
            ...FULL_REPORT_ACCESS,
            sections: {
                contentAnalysis: { ...FULL_REPORT_ACCESS.sections.contentAnalysis, enabled: false },
                structureMetrics: {
                    ...FULL_REPORT_ACCESS.sections.structureMetrics,
                    enabled: false,
                },
                comparisonNotes: { enabled: false, limit: 4 },
            },
        })
        expect(report.contentAnalysis).toBeUndefined()
        expect(report.structureMetrics).toEqual({})
        expect(report.structureReferences).toEqual({})
        expect(report.structureLocations).toBeUndefined()
        expect(report.comparisonNotes).toEqual([])
        expect(report.primaryScore?.value).toBe(8.4)
    })

    it('投影契约拒绝重新塞入的受限字段、超额参考和未知字段', () => {
        const report = projectCheckupReport(fixture(), ANONYMOUS_SKILL_REPORT_ACCESS)
        const attempts = [
            { ...report, structureMetrics: { ...report.structureMetrics, imageCount: 3 } },
            {
                ...report,
                contentAnalysis: {
                    ...report.contentAnalysis,
                    advice: fixture().contentAnalysis?.advice,
                },
            },
            { ...report, noteScoringAudit: fixture().noteScoringAudit },
            { ...report, comparisonNotes: fixture().comparisonNotes },
            { ...report, privateRaw: '未知信息' },
        ]
        for (const attempt of attempts)
            expect(projectedCheckupReportSchema.safeParse(attempt).success).toBe(false)
    })

    it('历史报告缺少新字段时不补数据，也不改变原来的分数', () => {
        const omitted = [
            'noteScoringAudit',
            'noteScoringCoefficient',
            'structureMetricsVersion',
            'structureLocations',
            'contentAnalysis',
        ]
        const base = Object.fromEntries(
            Object.entries(fixture()).filter(([key]) => !omitted.includes(key)),
        )
        const saved = checkupReportSchema.parse(base)
        const projected = projectCheckupReport(saved, ANONYMOUS_SKILL_REPORT_ACCESS)
        expect(projected.contentAnalysis).toBeUndefined()
        expect(projected.primaryScore).toEqual(saved.primaryScore)
        expect(projected.structureLocations).toBeUndefined()
    })

    it('配置校验拒绝遗漏开关、未知指标、负数和超额篇数', () => {
        const invalid = [
            {
                ...FULL_REPORT_ACCESS,
                sections: {
                    ...FULL_REPORT_ACCESS.sections,
                    comparisonNotes: { enabled: true, limit: 11 },
                },
            },
            {
                ...FULL_REPORT_ACCESS,
                sections: {
                    ...FULL_REPORT_ACCESS.sections,
                    comparisonNotes: { enabled: true, limit: -1 },
                },
            },
            {
                ...FULL_REPORT_ACCESS,
                sections: {
                    ...FULL_REPORT_ACCESS.sections,
                    contentAnalysis: { enabled: true, indicators: { consistency: true } },
                },
            },
            {
                ...FULL_REPORT_ACCESS,
                sections: {
                    ...FULL_REPORT_ACCESS.sections,
                    contentAnalysis: {
                        enabled: true,
                        indicators: {
                            ...FULL_REPORT_ACCESS.sections.contentAnalysis.indicators,
                            unknown: true,
                        },
                    },
                },
            },
        ]
        for (const value of invalid)
            expect(reportAccessPolicySchema.safeParse(value).success).toBe(false)
    })
})
