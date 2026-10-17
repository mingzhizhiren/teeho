import { afterAll, beforeAll, expect, test } from 'bun:test'
import type { PGlite } from '@electric-sql/pglite'
import { createCommunityDatabase } from './community-database'
import { noteCoefficientReport } from './note-scoring-coefficient.fixture'

let database: PGlite
beforeAll(async () => {
    database = await createCommunityDatabase()
}, 30_000)
afterAll(async () => {
    await database?.close()
})

async function valid(report: unknown, score: number): Promise<boolean> {
    const result = await database.query<{ valid: boolean }>(
        'SELECT teeho_internal.analysis_note_coefficient_valid($1::jsonb, $2::numeric, $3::text) AS valid',
        [JSON.stringify(report), score, 'analysis-result.v7'],
    )
    return result.rows[0]!.valid
}

test('压平后的完整社区迁移允许十篇对照并拒绝十一篇', async () => {
    for (const count of [4, 8, 10, 11]) {
        const report = {
            ...noteCoefficientReport(),
            comparisonNotes: Array.from({ length: count }, (_, index) => ({
                noteId: `note-${index}`,
            })),
        }
        expect(await valid(report, 8.72)).toBe(count <= 10)
    }
})

test('持久化同时支持结构系数、原有六档星级、封顶和最终一次舍入', async () => {
    for (const [stars, score] of [
        [0, 0],
        [1, 2.61],
        [2, 5.23],
        [3, 8.72],
        [4, 8.72],
        [5, 8.72],
    ])
        expect(await valid(noteCoefficientReport(stars, 8.3, score), score!)).toBe(true)
    expect(await valid(noteCoefficientReport(1, 8.3049, 2.62), 2.62)).toBe(true)
    expect(await valid(noteCoefficientReport(1, 8.3049, 2.61), 2.61)).toBe(false)
    expect(await valid(noteCoefficientReport(5, 9.99, 10), 10)).toBe(true)
    const base = noteCoefficientReport(5, 8.3049, 8.72)
    expect(
        await valid(
            { ...base, insight: null, primaryScore: { source: 'radar_average', value: 8.72 } },
            8.72,
        ),
    ).toBe(true)
})

test('SQL 拒绝缺失或伪造系数、未知策略、重复指标和错误分项贡献', async () => {
    const base = noteCoefficientReport()
    for (const invalid of [
        { ...base, noteScoringCoefficient: undefined },
        { ...base, noteScoringAudit: undefined },
        { ...base, noteScoringCoefficient: 1.1 },
        { ...base, noteScoringCoefficient: '1.05' },
        { ...base, noteScoringCoefficient: 1 },
        { ...base, primaryScore: { source: 'insight', value: 8.3 } },
        { ...base, insight: { ...base.insight, score: 8.3 } },
        { ...base, noteScoringAudit: { ...base.noteScoringAudit, policy: 'unknown' } },
        { ...base, noteScoringAudit: { ...base.noteScoringAudit, reviewCompleted: false } },
        { ...base, noteScoringAudit: { ...base.noteScoringAudit, notApplicable: ['imageCount'] } },
        {
            ...base,
            noteScoringAudit: {
                ...base.noteScoringAudit,
                evaluated: base.noteScoringAudit.evaluated.map(
                    () => base.noteScoringAudit.evaluated[0],
                ),
            },
        },
        {
            ...base,
            noteScoringAudit: {
                ...base.noteScoringAudit,
                evaluated: base.noteScoringAudit.evaluated.map((entry) => ({
                    ...entry,
                    contribution: 0.05,
                })),
            },
        },
        { ...base, structureMetrics: { ...base.structureMetrics, bodyLength: null } },
        { ...base, structureMetrics: { ...base.structureMetrics, bodyLength: '10' } },
        { ...base, structureReferences: { ...base.structureReferences, bodyLength: null } },
        {
            ...base,
            structureReferences: {
                ...base.structureReferences,
                bodyLength: { low: 10, high: 1, severity: 'aligned', sampleCount: 20 },
            },
        },
        { ...base, contentAnalysis: { ...base.contentAnalysis, originalScore: undefined } },
        { ...base, contentAnalysis: { ...base.contentAnalysis, scorePolicy: 'unknown' } },
        { ...base, referenceRequirement: 'required' },
    ])
        expect(await valid(invalid, 8.72)).toBe(false)
})

test('全部不可评和未完成评审使用中性上限，不把空证据当通过', async () => {
    const base = noteCoefficientReport(3, 8.3, 8.3)
    const fallback = {
        ...base,
        noteScoringCoefficient: 1,
        noteScoringAudit: { ...base.noteScoringAudit, reviewCompleted: false },
        contentAnalysis: { ...base.contentAnalysis, status: 'fallback' },
    }
    expect(await valid(fallback, 8.3)).toBe(true)
    expect(await valid({ ...fallback, noteScoringCoefficient: 1.05 }, 8.3)).toBe(false)
    const unavailable = {
        ...base,
        noteScoringCoefficient: 1,
        structureReferences: Object.fromEntries(
            Object.keys(base.structureMetrics).map((name) => [name, null]),
        ),
        noteScoringAudit: {
            ...base.noteScoringAudit,
            evaluated: [],
            unavailable: base.noteScoringAudit.evaluated.map((entry) => entry.metric),
        },
    }
    expect(await valid(unavailable, 8.3)).toBe(true)
    const partial = {
        ...base,
        noteScoringCoefficient: 1,
        structureReferences: { ...base.structureReferences, imageCount: null },
        noteScoringAudit: {
            ...base.noteScoringAudit,
            evaluated: base.noteScoringAudit.evaluated
                .filter((entry) => entry.metric !== 'imageCount')
                .map((entry) => ({ ...entry, contribution: 0.5 / 8 })),
            unavailable: ['imageCount'],
        },
    }
    expect(await valid(partial, 8.3)).toBe(true)
})

test('视频排除图片项，零星仅允许明确保存的原始分不可用', async () => {
    const base = noteCoefficientReport()
    const reference = { low: 10, high: 10, severity: 'aligned', sampleCount: 20 }
    const video = {
        ...base,
        structureMetrics: { ...base.structureMetrics, imageCount: null, videoDurationSeconds: 10 },
        structureReferences: {
            ...base.structureReferences,
            imageCount: null,
            videoDurationSeconds: reference,
        },
        noteScoringAudit: {
            ...base.noteScoringAudit,
            contentKind: 'video',
            notApplicable: ['imageCount'],
            evaluated: base.noteScoringAudit.evaluated.map((entry) => ({
                ...entry,
                metric: entry.metric === 'imageCount' ? 'videoDurationSeconds' : entry.metric,
            })),
        },
    }
    expect(await valid(video, 8.72)).toBe(true)
    const blocked = noteCoefficientReport(0, 8.3, 0)
    expect(
        await valid(
            { ...blocked, contentAnalysis: { ...blocked.contentAnalysis, originalScore: null } },
            0,
        ),
    ).toBe(true)
    expect(
        await valid(
            {
                ...blocked,
                contentAnalysis: { ...blocked.contentAnalysis, originalScore: undefined },
            },
            0,
        ),
    ).toBe(false)
})

test('校验函数不可被匿名或普通登录用户调用，不扩大表访问权限', async () => {
    const result = await database.query<{
        anon: boolean
        authenticated: boolean
        service: boolean
        definer: boolean
    }>(`
        SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
            has_function_privilege('service_role', p.oid, 'EXECUTE') AS service,
            p.prosecdef AS definer
        FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'teeho_internal' AND p.proname IN
            ('analysis_note_coefficient_valid', 'analysis_report_before_note_coefficient')
    `)
    expect(result.rows).toHaveLength(2)
    expect(
        result.rows.every((row) => !row.anon && !row.authenticated && row.service && !row.definer),
    ).toBe(true)
})
