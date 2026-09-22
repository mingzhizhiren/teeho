import { expect, test } from 'bun:test'
import { analysisResultSchema } from '@/features/analysis/analysis.contract'
import { checkupResult } from './checkupResult.fixture'
import { contentAnalysisFixture } from './contentAnalysis.fixture'

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
