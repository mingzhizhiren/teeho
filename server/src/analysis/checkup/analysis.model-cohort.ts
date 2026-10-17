import { randomInt } from 'node:crypto'
import { z } from 'zod'
import type { AnalysisEvidenceSet } from '../evidence/analysis.evidence'
import type { ReferenceSelectionMode } from '../../runtime/reference-selection'

export const MODEL_COHORT_KEY = 'teeho/model-cohort'
export const MODEL_COHORT_POLICY = 'model-median-tiered-interactions.v1'
/** 互动仅用于付费候选排序，不作为淘汰条件；阈值严格大于。 */
export const MODEL_COHORT_SELECTION = {
    standardTop: 20,
    priorityTop: 10,
    likesThreshold: 100,
    collectsThreshold: 30,
} as const
export const MODEL_COHORT_LIMITS = {
    perSource: 50,
    total: 100,
    sourceCount: 2,
    baseQuota: 2,
    baseDisplay: 4,
    coffeeQuota: 4,
    coffeeDisplay: 8,
    quota: 5,
    display: 10,
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
    sources: z.array(sourceSchema).min(1).max(MODEL_COHORT_LIMITS.sourceCount),
    likes: z.number().int().nonnegative().optional(),
    collects: z.number().int().nonnegative().optional(),
})
export interface ScoredCandidate {
    readonly noteId: string
    readonly score: number
    readonly sources: readonly CandidateSource[]
    readonly likes?: number
    readonly collects?: number
}
export interface DisplayCandidate {
    readonly noteId: string
    readonly source: CandidateSource
}
interface SlottedCandidate extends DisplayCandidate {
    readonly slot: number
}
export const modelCohortSchema = z
    .object({
        policy: z.enum([
            MODEL_COHORT_POLICY,
            'model-median-top10-ten.v1',
            'model-median-top10-eight.v1',
            'model-median-top10.v1',
            'model-median-top15.v1',
        ]),
        selectionMode: z.enum(['standard', 'engagement_priority']).optional(),
        modelId: z.string().min(1),
        parentEvidenceVersion: z.string().min(1),
        candidates: z
            .array(
                z.object({
                    noteId: z.string(),
                    sources: z.array(sourceSchema).min(1).max(MODEL_COHORT_LIMITS.sourceCount),
                }),
            )
            .max(MODEL_COHORT_LIMITS.total),
        scored: z.array(scoredSchema).max(MODEL_COHORT_LIMITS.total),
        median: z.number().finite().nullable(),
        excellentIds: z.array(z.string()).max(MODEL_COHORT_LIMITS.total),
        display: z
            .array(z.object({ noteId: z.string(), source: sourceSchema }))
            .max(MODEL_COHORT_LIMITS.display),
    })
    .superRefine((value, context) => {
        const maximum =
            value.policy === MODEL_COHORT_POLICY || value.policy === 'model-median-top10-ten.v1'
                ? MODEL_COHORT_LIMITS.display
                : value.policy === 'model-median-top10-eight.v1'
                  ? MODEL_COHORT_LIMITS.coffeeDisplay
                  : MODEL_COHORT_LIMITS.baseDisplay
        if (value.display.length > maximum)
            context.addIssue({
                code: 'custom',
                path: ['display'],
                message: 'Legacy cohort exceeds saved display limit',
            })
        if (value.policy === MODEL_COHORT_POLICY && !value.selectionMode)
            context.addIssue({
                code: 'custom',
                path: ['selectionMode'],
                message: 'Selection mode required',
            })
    })
export type ModelCohort = z.infer<typeof modelCohortSchema>

function shuffled<T>(items: readonly T[], random: () => number): T[] {
    // 独立随机键仅作用于对应策略的有界候选；随机结果随后随证据首写冻结。
    return items
        .map((item) => ({ item, key: random() }))
        .sort((a, b) => a.key - b.key)
        .map(({ item }) => item)
}

/** 增广时保持原槽位及来源不变，扩展不能打乱前四篇和前八篇的来源配额。 */
function assign(
    source: CandidateSource,
    pools: Record<CandidateSource, readonly string[]>,
    selected: readonly SlottedCandidate[],
    slot: number = selected.length,
    visited: readonly string[] = [],
): SlottedCandidate[] | null {
    for (const noteId of pools[source]) {
        if (visited.includes(noteId)) continue
        const occupied = selected.find((item) => item.noteId === noteId)
        const rest = selected.filter((item) => item.noteId !== noteId)
        const moved = occupied
            ? assign(occupied.source, pools, rest, occupied.slot, [...visited, noteId])
            : [...rest]
        if (moved) return [...moved, { noteId, source, slot }].sort((a, b) => a.slot - b.slot)
    }
    return null
}

function fillStage(
    pools: Record<CandidateSource, readonly string[]>,
    selected: readonly SlottedCandidate[],
    maximum: number,
    quota: number,
): SlottedCandidate[] {
    const sources = ['sql', 'semantic'] as const
    const assigned = sources
        .flatMap((source) => Array.from({ length: quota }, () => source))
        .reduce<
            SlottedCandidate[]
        >((items, source) => assign(source, pools, items) ?? items, [...selected])
    return sources.reduce<SlottedCandidate[]>(
        (items, source) =>
            pools[source].reduce<SlottedCandidate[]>(
                (current, noteId) =>
                    current.length >= maximum || current.some((item) => item.noteId === noteId)
                        ? current
                        : [...current, { noteId, source, slot: current.length }],
                items,
            ),
        assigned,
    )
}

function selectDisplay(pools: Record<CandidateSource, readonly string[]>): DisplayCandidate[] {
    const first = fillStage(
        pools,
        [],
        MODEL_COHORT_LIMITS.baseDisplay,
        MODEL_COHORT_LIMITS.baseQuota,
    )
    const coffee = fillStage(
        pools,
        first,
        MODEL_COHORT_LIMITS.coffeeDisplay,
        MODEL_COHORT_LIMITS.coffeeQuota - MODEL_COHORT_LIMITS.baseQuota,
    )
    return fillStage(
        pools,
        coffee,
        MODEL_COHORT_LIMITS.display,
        MODEL_COHORT_LIMITS.quota - MODEL_COHORT_LIMITS.coffeeQuota,
    ).map(({ noteId, source }) => ({ noteId, source }))
}

function hasPreferredEngagement(candidate: ScoredCandidate): boolean {
    return (
        (candidate.likes ?? 0) > MODEL_COHORT_SELECTION.likesThreshold &&
        (candidate.collects ?? 0) > MODEL_COHORT_SELECTION.collectsThreshold
    )
}

/** 保留中位数优秀集合；排序优先级仅影响各路抽样池，不改变评分或统计群体。 */
export function selectModelCohort(
    candidates: readonly ScoredCandidate[],
    random: () => number = () =>
        randomInt(MODEL_COHORT_LIMITS.randomRange) / MODEL_COHORT_LIMITS.randomRange,
    mode: ReferenceSelectionMode = 'standard',
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
    const ranked =
        mode === 'engagement_priority'
            ? [...excellent].sort(
                  (a, b) =>
                      Number(hasPreferredEngagement(b)) - Number(hasPreferredEngagement(a)) ||
                      b.score - a.score ||
                      a.noteId.localeCompare(b.noteId),
              )
            : excellent
    const top =
        mode === 'engagement_priority'
            ? MODEL_COHORT_SELECTION.priorityTop
            : MODEL_COHORT_SELECTION.standardTop
    const pool = (source: CandidateSource) =>
        shuffled(
            ranked
                .filter((item) => item.sources.includes(source))
                .slice(0, top)
                .map((item) => item.noteId),
            random,
        )
    const pools = { sql: pool('sql'), semantic: pool('semantic') }
    return {
        median,
        excellentIds: excellent.map((item) => item.noteId),
        display: selectDisplay(pools),
    }
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
