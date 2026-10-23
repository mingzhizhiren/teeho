import { describe, expect, it } from 'vitest'
import { MEDIA_STRUCTURE_KEYS, type MediaStructureFeatures } from '@teeho/content-metrics'
import { calculateNoteScoring, validSavedNoteScoring } from './analysis.note-scoring'
import { compareStructureMetrics } from './analysis.structure-metrics'
import { checkupReportSchema } from './analysis.checkup.contract'

const metrics: MediaStructureFeatures = {
    titleLength: 10,
    bodyLength: 10,
    paragraphLength: 10,
    paragraphCount: 10,
    topicCount: 10,
    topicLength: 10,
    maxTopicLength: 10,
    maxParagraphLength: 10,
    imageCount: 10,
    videoDurationSeconds: null,
}
const peers = Array.from({ length: 3 }, () => ({ ...metrics, videoDurationSeconds: null }))
const references = compareStructureMetrics(metrics, peers)
const radar = {
    topicDemand: 8.3,
    titleExpression: 8.3,
    contentDevelopment: 8.3,
    readingExperience: 8.3,
    interactionPotential: 8.3,
    distinctiveness: 8.3,
}

function savedReport(stars: number, originalScore: number, finalScore: number) {
    return {
        schemaVersion: 'analysis-result.v7',
        referenceRequirement: 'optional',
        structureMetrics: metrics,
        structureReferences: references,
        ...calculateNoteScoring('image', metrics, references, true, stars),
        contentAnalysis: {
            status: 'completed',
            scorePolicy: 'consistency-weighted.v2',
            originalScore,
            consistency: {
                stars,
                summary: '内容一致性检查已完成。',
                issues:
                    stars === 0
                        ? [{ location: 'title', evidence: '标题', description: '主题不一致。' }]
                        : [],
            },
            termRisks: [],
            weaknesses: [],
        },
        primaryTrack: 1,
        primaryScore: { source: 'insight', value: finalScore },
        insight: {
            status: 'available',
            score: finalScore,
            limited: false,
            reference: null,
            comparison: null,
        },
        radar,
        differences: [],
        qualitativeConclusion: { summary: '内容检查结果。' },
        comparisonNotes: [],
        topicSupport: { status: 'no_sources', matchedTopics: [], bonus: 0 },
    }
}

describe('笔记结构系数', () => {
    it.each([0, 1, 2, 3, 4, 5])('只有 %s 星中的五星增加 0.05，奖励也适用于未达标指标', (stars) => {
        const currentReferences = Object.fromEntries(
            Object.entries(references).map(([metric, reference]) => [
                metric,
                reference ? { ...reference, severity: 'moderate' as const } : null,
            ]),
        ) as typeof references
        const result = calculateNoteScoring('image', metrics, currentReferences, true, stars)
        expect(result.noteScoringCoefficient).toBeCloseTo(stars === 5 ? 0.8 : 0.75, 10)
        expect(result.noteScoringAudit.policy).toBe('structure-coefficient.v2')
    })

    it('缺项和无有效结构指标仍独立判断五星奖励，降级不奖励', () => {
        const missing = { ...references, imageCount: null }
        const empty = Object.fromEntries(
            MEDIA_STRUCTURE_KEYS.map((key) => [key, null]),
        ) as typeof references
        for (const current of [missing, empty]) {
            expect(
                calculateNoteScoring('image', metrics, current, true, 5).noteScoringCoefficient,
            ).toBe(1.05)
            expect(
                calculateNoteScoring('image', metrics, current, true, 4).noteScoringCoefficient,
            ).toBe(1)
            expect(
                calculateNoteScoring('image', metrics, current, false, 5).noteScoringCoefficient,
            ).toBe(1)
        }
    })

    it('旧 v1 四星报告保留 1.05，不能作为新 v2 四星奖励读取', () => {
        const current = savedReport(4, 8.3, 8.72)
        const legacy = {
            ...current,
            noteScoringCoefficient: 1.05,
            noteScoringAudit: { ...current.noteScoringAudit, policy: 'structure-coefficient.v1' },
        }
        expect(checkupReportSchema.parse(legacy).primaryScore?.value).toBe(8.72)
        expect(
            checkupReportSchema.safeParse({ ...legacy, noteScoringAudit: current.noteScoringAudit })
                .success,
        ).toBe(false)
    })

    it.each([
        [10, 'aligned', 1],
        [9, 'minor', 0.875],
        [8, 'moderate', 0.75],
        [6, 'major', 0.625],
        [0, 'critical', 0.5],
    ] as const)(
        '实测值 %s 的 %s 档使用已保存颜色档位，系数为 %s',
        (value, severity, coefficient) => {
            const current = {
                ...metrics,
                ...Object.fromEntries(
                    MEDIA_STRUCTURE_KEYS.filter((key) => key !== 'videoDurationSeconds').map(
                        (key) => [key, value],
                    ),
                ),
            }
            const currentReferences = compareStructureMetrics(current, peers)
            const result = calculateNoteScoring('image', current, currentReferences, true, 4)
            expect(result.noteScoringCoefficient).toBeCloseTo(coefficient, 10)
            expect(result.noteScoringAudit.evaluated).toHaveLength(9)
            expect(
                result.noteScoringAudit.evaluated.every((item) => item.severity === severity),
            ).toBe(true)
            expect(result.noteScoringAudit.notApplicable).toEqual(['videoDurationSeconds'])
        },
    )

    it('图片和视频互斥，不适用项不占额度，新增适用项自动平分', () => {
        const current = { ...metrics, imageCount: null, videoDurationSeconds: 10 }
        const currentReferences = compareStructureMetrics(
            current,
            Array.from({ length: 3 }, () => current),
        )
        const result = calculateNoteScoring('video', current, currentReferences, true, 4)
        expect(result.noteScoringCoefficient).toBe(1)
        expect(result.noteScoringAudit.notApplicable).toEqual(['imageCount'])
        expect(
            result.noteScoringAudit.evaluated.find((item) => item.metric === 'videoDurationSeconds')
                ?.contribution,
        ).toBeCloseTo(0.5 / 9)
    })

    it('部分缺值或缺参考只移出分母并封顶 1，全部不可评使用 1', () => {
        const partial = calculateNoteScoring(
            'image',
            { ...metrics, bodyLength: null },
            { ...references, imageCount: null },
            true,
            4,
        )
        expect(partial.noteScoringCoefficient).toBeCloseTo(1, 10)
        expect(partial.noteScoringAudit.unavailable).toEqual(['bodyLength', 'imageCount'])
        expect(partial.noteScoringAudit.evaluated).toHaveLength(7)
        const empty = calculateNoteScoring(
            'image',
            metrics,
            Object.fromEntries(MEDIA_STRUCTURE_KEYS.map((key) => [key, null])) as typeof references,
            true,
            4,
        )
        expect(empty.noteScoringCoefficient).toBe(1)
        expect(empty.noteScoringAudit.evaluated).toEqual([])
    })

    it('真实零正常评估，未完成内容检查不能取得奖励', () => {
        const current = { ...metrics, bodyLength: 0 }
        const result = calculateNoteScoring(
            'image',
            current,
            compareStructureMetrics(current, peers),
            true,
            4,
        )
        expect(
            result.noteScoringAudit.evaluated.find((item) => item.metric === 'bodyLength'),
        ).toMatchObject({ severity: 'critical', contribution: 0 })
        expect(result.noteScoringAudit.unavailable).toEqual([])
        expect(
            calculateNoteScoring('image', metrics, references, false, 5).noteScoringCoefficient,
        ).toBe(1)
    })

    it('冻结的贡献、适用性及评审状态不一致时拒绝报告', () => {
        const report = checkupReportSchema.parse(savedReport(5, 8.3, 8.72))
        expect(validSavedNoteScoring(report)).toBe(true)
        expect(
            checkupReportSchema.safeParse({ ...report, noteScoringCoefficient: 1 }).success,
        ).toBe(false)
        expect(
            checkupReportSchema.safeParse({ ...report, noteScoringAudit: undefined }).success,
        ).toBe(false)
        expect(
            checkupReportSchema.safeParse({
                ...report,
                noteScoringAudit: { ...report.noteScoringAudit, reviewCompleted: false },
            }).success,
        ).toBe(false)
        expect(
            checkupReportSchema.safeParse({
                ...report,
                structureReferences: { ...references, titleLength: null },
            }).success,
        ).toBe(false)
    })

    it.each([
        [0, 0],
        [1, 2.49],
        [2, 4.98],
        [3, 8.3],
        [4, 8.3],
        [5, 8.72],
    ])('保留 %s 星独立倍率，最终为 %s', (stars, expected) => {
        expect(
            checkupReportSchema.parse(savedReport(stars!, 8.3, expected!)).primaryScore?.value,
        ).toBe(expected)
    })

    it('所有倍率乘完后仅舍入一次，并封顶 10', () => {
        expect(checkupReportSchema.parse(savedReport(1, 8.316, 2.49)).primaryScore?.value).toBe(
            2.49,
        )
        expect(checkupReportSchema.safeParse(savedReport(1, 8.316, 2.5)).success).toBe(false)
        expect(checkupReportSchema.parse(savedReport(5, 9.99, 10)).primaryScore?.value).toBe(10)
    })

    it('历史报告缺省不补算系数，保持原始分及星级修正', () => {
        const legacy = {
            ...savedReport(2, 8.3, 4.98),
            noteScoringCoefficient: undefined,
            noteScoringAudit: undefined,
        }
        const parsed = checkupReportSchema.parse(legacy)
        expect(parsed.noteScoringCoefficient).toBeUndefined()
        expect(parsed.noteScoringAudit).toBeUndefined()
        expect(parsed.primaryScore?.value).toBe(4.98)
    })
})
