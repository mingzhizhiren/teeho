import {
    analysisTrackWeights,
    type AnalysisTrackSelection,
    type AnalysisTrackWeight,
} from './analysis.track-selection'

interface TaggedNote {
    readonly noteId: string
    readonly trackCodes?: readonly number[]
}

function quotas(count: number, groups: readonly AnalysisTrackWeight[]): number[] {
    const total = groups.reduce((sum, group) => sum + group.weight, 0)
    const shares = groups.map((group, index) => ({ index, exact: (count * group.weight) / total }))
    const remaining = count - shares.reduce((sum, share) => sum + Math.floor(share.exact), 0)
    const roundedUp = new Set(
        [...shares]
            .sort((a, b) => (b.exact % 1) - (a.exact % 1) || a.index - b.index)
            .slice(0, remaining)
            .map((share) => share.index),
    )
    return shares.map((share) => Math.floor(share.exact) + (roundedUp.has(share.index) ? 1 : 0))
}

function boundedQuotas(
    count: number,
    groups: readonly (AnalysisTrackWeight & { capacity: number })[],
): number[] {
    const total = groups.reduce((sum, group) => sum + group.weight, 0)
    const exhausted = groups.filter((group) => group.capacity < (count * group.weight) / total)
    if (!exhausted.length) return quotas(count, groups)
    const remaining = groups.filter((group) => !exhausted.includes(group))
    const rest = remaining.length
        ? boundedQuotas(
              count - exhausted.reduce((sum, group) => sum + group.capacity, 0),
              remaining,
          )
        : []
    return groups.map((group) =>
        exhausted.includes(group) ? group.capacity : rest[remaining.indexOf(group)]!,
    )
}

/** 按60:40分配整数名额；重复笔记仅计一次，缺额按剩余赛道权重补位。 */
export function sampleByTrack<T>(
    items: readonly T[],
    selection: AnalysisTrackSelection,
    limit: number,
    noteOf: (item: T) => TaggedNote,
): T[] {
    const weights = analysisTrackWeights(selection)
    const target = Math.max(0, Math.min(items.length, Math.floor(limit)))
    const seen = new Set<string>()
    const selected: T[] = []
    while (selected.length < target) {
        const pools = weights
            .map((group) => ({
                ...group,
                items: items.filter((item) => {
                    const note = noteOf(item)
                    return (
                        !seen.has(note.noteId) &&
                        (note.trackCodes ?? [weights[0]!.trackCode]).includes(group.trackCode)
                    )
                }),
            }))
            .filter((group) => group.items.length > 0)
        if (!pools.length) break
        const allocations = boundedQuotas(
            target - selected.length,
            pools.map((group) => ({
                ...group,
                capacity: new Set(group.items.map((item) => noteOf(item).noteId)).size,
            })),
        )
        const before = selected.length
        for (const [index, group] of pools.entries()) {
            let taken = 0
            for (const item of group.items) {
                if (taken >= allocations[index]!) break
                const id = noteOf(item).noteId
                if (seen.has(id)) continue
                seen.add(id)
                selected.push(item)
                taken += 1
            }
        }
        if (selected.length === before) break
    }
    return selected
}
