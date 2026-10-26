const MAXIMUM_SCORE = 10
const PERCENT_SCALE = 100

export interface ScoreRangeReference {
    readonly min?: number | null
    readonly max?: number | null
    readonly median?: number | null
}

export interface ScoreRangePosition {
    readonly minimum: number
    readonly maximum: number
    readonly median: number
    readonly percent: number
    readonly medianPercent: number
    readonly boundary: 'below' | 'within' | 'above'
}

/** 将已保存的最终评分映射到参考极值区间；不代表用户排名。 */
export function scoreRangePosition(
    score: number,
    reference: ScoreRangeReference | null | undefined,
): ScoreRangePosition | null {
    const minimum = reference?.min
    const maximum = reference?.max
    const median = reference?.median
    if (
        typeof minimum !== 'number' ||
        typeof maximum !== 'number' ||
        typeof median !== 'number' ||
        ![score, minimum, maximum, median].every(
            (value) => Number.isFinite(value) && value >= 0 && value <= MAXIMUM_SCORE,
        ) ||
        maximum <= minimum ||
        median < minimum ||
        median > maximum
    )
        return null
    const position = (value: number): number =>
        Math.min(PERCENT_SCALE, Math.max(0, ((value - minimum) / (maximum - minimum)) * PERCENT_SCALE))
    return {
        minimum,
        maximum,
        median,
        percent: position(score),
        medianPercent: position(median),
        boundary: score < minimum ? 'below' : score > maximum ? 'above' : 'within',
    }
}
