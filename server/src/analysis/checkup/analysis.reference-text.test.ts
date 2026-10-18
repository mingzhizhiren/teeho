import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { communityReportFixture, communityTaskFixture } from '../../test/community-task.fixture'
import { MockAnalysisEvidenceSource } from '../evidence/analysis.evidence'
import { checkupOutputConstraints } from './analysis.checkup.constants'
import { mapCheckupReferences, type SelectedCheckupNote } from './analysis.checkup.selection'

async function sample(title: string, body: string): Promise<SelectedCheckupNote> {
    const evidence = await new MockAnalysisEvidenceSource().load({
        task: communityTaskFixture(),
        inputFingerprint: 'unicode-reference',
        signal: new AbortController().signal,
    })
    const original = evidence.notes[0]!
    return {
        note: { ...original, title, body, topics: ['摄影'] },
        latest: original.observations[0]!,
        similarity: 1,
    }
}

const fields = [
    { field: 'title', limit: checkupOutputConstraints.referenceTitleMaxLength },
    { field: 'bodyExcerpt', limit: checkupOutputConstraints.excerptMaxLength },
] as const

it.each(fields)('$field 截断边界不拆分emoji，并保留原UTF-16长度限制', async ({ field, limit }) => {
    const prefix = '文'.repeat(limit - 2)
    const input = prefix + '📷后续文字'
    const selected = await sample(input, input)
    const before = structuredClone(selected)
    const reference = mapCheckupReferences([selected])[0]!
    expect(reference[field]).toBe(prefix + '…')
    expect(reference[field].length).toBeLessThanOrEqual(limit)
    expect(reference[field]).not.toMatch(/[\uD800-\uDFFF]/u)
    expect(selected).toEqual(before)
})

it.each(fields)('$field 边界前完整emoji保留，恰好到上限的原文不截断', async ({ field, limit }) => {
    for (const [input, expected] of [
        ['文'.repeat(limit - 3) + '📷后续', '文'.repeat(limit - 3) + '📷…'],
        ['文'.repeat(limit - 1) + '📷后续', '文'.repeat(limit - 1) + '…'],
        ['文'.repeat(limit - 2) + '📷', '文'.repeat(limit - 2) + '📷'],
        ['文'.repeat(limit + 1), '文'.repeat(limit - 1) + '…'],
        ['短文📷', '短文📷'],
    ]) {
        const reference = mapCheckupReferences([await sample(input!, input!)])[0]!
        expect(reference[field]).toBe(expected)
        expect(reference[field].length).toBeLessThanOrEqual(limit)
    }
})

it('实际映射生成的标题与摘要可以作为完整报告写入PostgreSQL JSONB', async () => {
    const selected = await sample(
        '文'.repeat(checkupOutputConstraints.referenceTitleMaxLength - 2) + '📷后续',
        '#摄影[话题]# ' + '文'.repeat(checkupOutputConstraints.excerptMaxLength - 2) + '📷后续',
    )
    const report = {
        ...communityReportFixture(),
        comparisonNotes: mapCheckupReferences([selected]),
    }
    const database = new PGlite()
    try {
        await database.exec('CREATE TABLE reports (report jsonb NOT NULL)')
        const saved = await database.query<{ report: unknown }>(
            'INSERT INTO reports (report) VALUES ($1::jsonb) RETURNING report',
            [JSON.stringify(report)],
        )
        expect(saved.rows[0]?.report).toEqual(report)
        expect(report.comparisonNotes[0]?.bodyExcerpt).not.toContain('#摄影')
        expect(report.comparisonNotes[0]?.topics).toEqual(['摄影'])
    } finally {
        await database.close()
    }
}, 30_000)
