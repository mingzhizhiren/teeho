import { describe, expect, it } from 'vitest'
import {
    MODEL_COHORT_POLICY,
    modelCohortSchema,
    selectModelCohort,
    type CandidateSource,
    type ScoredCandidate,
} from './analysis.model-cohort'

function candidates(sql: number, semantic: number, shared: number): ScoredCandidate[] {
    const group = (prefix: string, length: number, sources: CandidateSource[]) =>
        Array.from({ length }, (_, index) => ({ noteId: `${prefix}-${index}`, score: 7, sources }))
    return [
        ...group('a-shared', shared, ['sql', 'semantic']),
        ...group('b-sql', sql, ['sql']),
        ...group('c-semantic', semantic, ['semantic']),
    ]
}

describe('十篇模型对照的分层配额', () => {
    it('增广保留前四篇二加二、前八篇四加四、完整十篇五加五', () => {
        const result = selectModelCohort(candidates(5, 0, 5), () => 0)
        expect(result.display).toHaveLength(10)
        expect(result.display.map((note) => note.source)).toEqual([
            'sql',
            'sql',
            'semantic',
            'semantic',
            'sql',
            'sql',
            'semantic',
            'semantic',
            'sql',
            'semantic',
        ])
        expect(
            result.display
                .filter((note) => note.source === 'semantic')
                .every((note) => note.noteId.startsWith('a-shared')),
        ).toBe(true)
        expect(new Set(result.display.map((note) => note.noteId)).size).toBe(10)
    })

    it('两路都指向同一批十篇时不重复展示，也不破坏任一档位的配额', () => {
        const result = selectModelCohort(candidates(0, 0, 10), () => 0)
        expect(new Set(result.display.map((note) => note.noteId)).size).toBe(10)
        for (const [limit, quota] of [
            [4, 2],
            [8, 4],
            [10, 5],
        ]) {
            const prefix = result.display.slice(0, limit)
            expect(prefix.filter((note) => note.source === 'sql')).toHaveLength(quota)
            expect(prefix.filter((note) => note.source === 'semantic')).toHaveLength(quota)
        }
    })

    it('覆盖不同重叠与缺额组合：可满足时平分配额，缺额时只补真实候选', () => {
        for (let sql = 0; sql <= 10; sql += 1) {
            for (let semantic = 0; semantic <= 10; semantic += 1) {
                for (let shared = 0; shared <= 10; shared += 1) {
                    const input = candidates(sql, semantic, shared)
                    const result = selectModelCohort(input, () => 0, 'engagement_priority')
                    const sqlPool = input
                        .filter((note) => note.sources.includes('sql'))
                        .slice(0, 10)
                    const semanticPool = input
                        .filter((note) => note.sources.includes('semantic'))
                        .slice(0, 10)
                    const union = new Set([...sqlPool, ...semanticPool].map((note) => note.noteId))
                    expect(result.display.length).toBe(Math.min(10, union.size))
                    expect(new Set(result.display.map((note) => note.noteId)).size).toBe(
                        result.display.length,
                    )
                    for (const note of result.display) {
                        const pool = note.source === 'sql' ? sqlPool : semanticPool
                        expect(pool.some((candidate) => candidate.noteId === note.noteId)).toBe(
                            true,
                        )
                    }
                    for (const [limit, quota] of [
                        [4, 2],
                        [8, 4],
                        [10, 5],
                    ]) {
                        if (
                            union.size < limit! ||
                            sqlPool.length < quota! ||
                            semanticPool.length < quota!
                        )
                            continue
                        const prefix = result.display.slice(0, limit)
                        expect(prefix.filter((note) => note.source === 'sql')).toHaveLength(quota)
                        expect(prefix.filter((note) => note.source === 'semantic')).toHaveLength(
                            quota,
                        )
                    }
                }
            }
        }
    })

    it('新快照允许十篇，旧快照保持四篇或八篇，来源种类始终最多两个', () => {
        const selected = selectModelCohort(candidates(5, 5, 0), () => 0)
        const frozen = {
            policy: MODEL_COHORT_POLICY,
            selectionMode: 'standard',
            modelId: 'fixture',
            parentEvidenceVersion: 'fixture',
            candidates: candidates(5, 5, 0).map(({ noteId, sources }) => ({ noteId, sources })),
            scored: candidates(5, 5, 0),
            ...selected,
        }
        expect(modelCohortSchema.safeParse(frozen).success).toBe(true)
        for (const policy of ['model-median-top10.v1', 'model-median-top15.v1']) {
            expect(modelCohortSchema.safeParse({ ...frozen, policy }).success).toBe(false)
            const legacy = { ...frozen, policy, display: frozen.display.slice(0, 4) }
            expect(modelCohortSchema.parse(legacy)).toEqual(legacy)
        }
        const eight = {
            ...frozen,
            policy: 'model-median-top10-eight.v1',
            display: frozen.display.slice(0, 8),
        }
        expect(modelCohortSchema.parse(eight)).toEqual(eight)
        expect(modelCohortSchema.safeParse({ ...eight, display: frozen.display }).success).toBe(
            false,
        )
        expect(
            modelCohortSchema.safeParse({
                ...frozen,
                scored: [{ noteId: 'bad', score: 7, sources: ['sql', 'semantic', 'sql'] }],
            }).success,
        ).toBe(false)
    })
})
