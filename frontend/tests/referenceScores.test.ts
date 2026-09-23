import { expect, test } from 'bun:test'
import { analysisResultSchema } from '@/features/analysis/analysis.contract'
import { checkupResult } from './checkupResult.fixture'
import { contentAnalysisFixture } from './contentAnalysis.fixture'

test('四篇混合参考及建议引用可完整读取，第五篇仍拒绝', () => {
    const comparisonNotes = Array.from({ length: 4 }, (_, index) => ({
        ...checkupResult.comparisonNotes[0],
        noteId: `reference-${index}`,
        reason: index < 2 ? 'similar_content' : 'semantic_similarity',
        modelScore: index,
    }))
    const report = {
        ...checkupResult,
        schemaVersion: 'analysis-result.v7',
        primaryScore: { source: 'insight', value: 7 },
        insight: { ...checkupResult.insight, score: 7 },
        comparisonNotes,
        contentAnalysis: {
            ...contentAnalysisFixture,
            weaknesses: [
                {
                    ...contentAnalysisFixture.weaknesses[0],
                    referenceIds: comparisonNotes.map((note) => note.noteId),
                },
            ],
        },
    }
    expect(analysisResultSchema.parse(report).comparisonNotes).toHaveLength(4)
    expect(
        analysisResultSchema.safeParse({
            ...report,
            comparisonNotes: [...comparisonNotes, comparisonNotes[0]],
        }).success,
    ).toBe(false)
})

test('报告参考可保存零分、空分和旧记录缺省分，不改变主分', () => {
    for (const fields of [{ modelScore: 0, modelId: 'model' }, { modelScore: null }, {}]) {
        const report = analysisResultSchema.parse({
            ...checkupResult,
            comparisonNotes: checkupResult.comparisonNotes.map((note) => ({ ...note, ...fields })),
        })
        expect(report.comparisonNotes[0]).toMatchObject(fields)
        expect(report.insight?.score).toBe(checkupResult.insight?.score)
    }
})

test('已有分析模块接收有引用的修改方向，保留旧记录缺省', () => {
    const result = analysisResultSchema.parse({
        ...checkupResult,
        schemaVersion: 'analysis-result.v7',
        primaryScore: { source: 'insight', value: 7 },
        insight: { ...checkupResult.insight, score: 7 },
        contentAnalysis: {
            ...contentAnalysisFixture,
            weaknesses: [
                {
                    ...contentAnalysisFixture.weaknesses[0],
                    suggestion: '补充具体使用场景。'.repeat(60),
                },
            ],
        },
    })
    expect(result.contentAnalysis?.weaknesses[0]?.suggestion).toContain('补充具体使用场景。')
})
