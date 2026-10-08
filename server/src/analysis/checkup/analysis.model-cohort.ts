import { randomInt } from 'node:crypto'
import { z } from 'zod'
import type { AnalysisEvidenceSet } from '../evidence/analysis.evidence'

export const MODEL_COHORT_KEY = 'teeho/model-cohort'
export const MODEL_COHORT_POLICY = 'model-median-top15.v1'
export const MODEL_COHORT_LIMITS = {
    perSource: 50,
    total: 100,
    top: 15,
    quota: 2,
    display: 4,
    minimum: 3,
    concurrency: 4,
    maxScore: 10,
    randomRange: 0x100000000,
} as const
export type CandidateSource = 'sql' | 'semantic'
const sourceSchema = z.enum(['sql', 'semantic'])
const scoredSchema = z.object({
    noteId: z.string().min(1),
    score: z.number().finite().min(0).max(MODEL_COHORT_LIMITS.maxScore),
    sources: z.array(sourceSchema).min(1).max(MODEL_COHORT_LIMITS.quota),
})
export interface ScoredCandidate {
    readonly noteId: string
    readonly score: number
    readonly sources: readonly CandidateSource[]
}
export interface DisplayCandidate {
    readonly noteId: string
    readonly source: CandidateSource
}
export const modelCohortSchema = z.object({
    policy: z.literal(MODEL_COHORT_POLICY),
    modelId: z.string().min(1),
    parentEvidenceVersion: z.string().min(1),
    candidates: z
        .array(z.object({ noteId: z.string(), sources: z.array(sourceSchema) }))
        .max(MODEL_COHORT_LIMITS.total),
    scored: z.array(scoredSchema).max(MODEL_COHORT_LIMITS.total),
    median: z.number().finite().nullable(),
    excellentIds: z.array(z.string()).max(MODEL_COHORT_LIMITS.total),
    display: z
        .array(z.object({ noteId: z.string(), source: sourceSchema }))
        .max(MODEL_COHORT_LIMITS.display),
})
export type ModelCohort = z.infer<typeof modelCohortSchema>

function shuffled<T>(items: readonly T[], random: () => number): T[] {
    // 独立随机键仅作用于前十五候选；随机结果随后随证据首写冻结。
    return items
        .map((item) => ({ item, key: random() }))
        .sort((a, b) => a.key - b.key)
        .map(({ item }) => item)
}

/** 来源双命中的笔记通过增广分配保留两路名额，任何笔记只展示一次。 */
function assign(
    source: CandidateSource,
    pools: Record<CandidateSource, readonly string[]>,
    selected: readonly DisplayCandidate[],
    visited: readonly string[] = [],
): DisplayCandidate[] | null {
    for (const noteId of pools[source]) {
        if (visited.includes(noteId)) continue
        const occupied = selected.find((item) => item.noteId === noteId)
        const rest = selected.filter((item) => item.noteId !== noteId)
        const moved = occupied
            ? assign(occupied.source, pools, rest, [...visited, noteId])
            : [...rest]
        if (moved) return [...moved, { noteId, source }]
    }
    return null
}

/** 模型分决定优秀集合；展示在每路前十五中随机、按二加二配额去重补位。 */
export function selectModelCohort(
    candidates: readonly ScoredCandidate[],
    random: () => number = () =>
        randomInt(MODEL_COHORT_LIMITS.randomRange) / MODEL_COHORT_LIMITS.randomRange,
): Pick<ModelCohort, 'median' | 'excellentIds' | 'display'> {
    const ordered = [...candidates].sort(
        (a, b) => a.score - b.score || a.noteId.localeCompare(b.noteId),
    )
    if (!ordered.length) return { median: null, excellentIds: [], display: [] }
    const half = 0.5
    const middle = (ordered.length - 1) * half
    const median = (ordered[Math.floor(middle)]!.score + ordered[Math.ceil(middle)]!.score) * half
    const excellent = ordered
        .filter((item) => item.score >= median)
        .sort((a, b) => b.score - a.score || a.noteId.localeCompare(b.noteId))
    const pool = (source: CandidateSource) =>
        shuffled(
            excellent
                .filter((item) => item.sources.includes(source))
                .slice(0, MODEL_COHORT_LIMITS.top)
                .map((item) => item.noteId),
            random,
        )
    const pools = { sql: pool('sql'), semantic: pool('semantic') }
    let display: DisplayCandidate[] = []
    for (const source of ['sql', 'sql', 'semantic', 'semantic'] as const)
        display = assign(source, pools, display) ?? display
    for (const source of ['sql', 'semantic'] as const) {
        for (const noteId of pools[source]) {
            if (display.length >= MODEL_COHORT_LIMITS.display) break
            if (!display.some((item) => item.noteId === noteId))
                display = [...display, { noteId, source }]
        }
    }
    return { median, excellentIds: excellent.map((item) => item.noteId), display }
}

/** 只读取已验证冻结快照；非法快照必须失败，不能悄悄改用旧选样。 */
export function readModelCohort(evidence: AnalysisEvidenceSet): ModelCohort | null {
    const value = evidence.extensions?.[MODEL_COHORT_KEY]
    return value === undefined ? null : modelCohortSchema.parse(value)
}

/** 所有统计消费同一优秀集合，保留原证据中的其他审计信息。 */
export function modelCohortEvidence(evidence: AnalysisEvidenceSet): AnalysisEvidenceSet {
    const cohort = readModelCohort(evidence)
    if (!cohort) return evidence
    return {
        ...evidence,
        notes: evidence.notes.filter((note) => cohort.excellentIds.includes(note.noteId)),
    }
}
