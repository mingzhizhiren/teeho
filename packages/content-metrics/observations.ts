/** 案例筛选的时间与数量边界；不包含模型或商业评分权重。 */
export const PERFORMANCE = {
    version: 'community-observed-interactions.v1',
    dayMs: 86_400_000,
    hourMs: 3_600_000,
    maximumDays: 30,
    minimumSamples: 10,
    candidateLimit: 1000,
    windows: [1, 7, 30],
    topFraction: 0.25,
    maxScore: 10,
    decimals: 100,
} as const

export interface PerformanceObservation {
    readonly observedAt: string
    readonly observationId?: string
    readonly likes: number | null
    readonly collects: number | null
    readonly comments?: number | null
    readonly shares?: number | null
}

export interface PerformanceNote {
    readonly publishedAt: string
    readonly observations: readonly PerformanceObservation[]
}

/** 观察时间降序；同一时刻按稳定记录身份消歧。 */
export function comparePerformanceObservations(
    left: Readonly<{ observedAt: string; observationId?: string }>,
    right: Readonly<{ observedAt: string; observationId?: string }>,
): number {
    const difference = Date.parse(right.observedAt) - Date.parse(left.observedAt)
    if (difference !== 0) return difference
    const leftId = left.observationId ?? ''
    const rightId = right.observationId ?? ''
    return leftId > rightId ? -1 : leftId < rightId ? 1 : 0
}

/** 上海自然日窗口包含当天；无效日期或非正整数窗口明确拒绝。 */
export function performanceWindowStart(asOf: string, days: number): number {
    const timestamp = Date.parse(asOf)
    if (!Number.isFinite(timestamp) || !Number.isSafeInteger(days) || days < 1) {
        throw new Error('invalid_observation_window')
    }
    const offset = 8 * PERFORMANCE.hourMs
    const day = Math.floor((timestamp + offset) / PERFORMANCE.dayMs)
    return day * PERFORMANCE.dayMs - offset - (days - 1) * PERFORMANCE.dayMs
}

/** 教学案例按截止时点的最新实测互动总量排序，缺失不推算；不预测质量。 */
export function scorePerformance(notes: readonly PerformanceNote[], asOf: string): number[] {
    const cutoff = Date.parse(asOf)
    if (!Number.isFinite(cutoff)) throw new Error('invalid_observation_cutoff')
    const totals = notes.map((note) => {
        const latest = note.observations
            .filter((observation) => Date.parse(observation.observedAt) <= cutoff)
            .sort(comparePerformanceObservations)[0]
        if (!latest) return 0
        return [latest.likes, latest.collects, latest.comments, latest.shares].reduce<number>(
            (sum, value) =>
                typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
                    ? sum + value
                    : sum,
            0,
        )
    })
    const maximum = Math.max(1, ...totals)
    return totals.map((total) => total / maximum)
}
