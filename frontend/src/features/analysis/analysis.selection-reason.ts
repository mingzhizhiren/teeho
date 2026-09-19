/** 入选理由的稳定枚举值，文案由语言目录提供。 */
export const SELECTION_REASONS = ['high_exposure', 'rapid_growth'] as const
export type SelectionReason = (typeof SELECTION_REASONS)[number]
const HIGH_EXPOSURE = { likes: 10_000, collects: 1_000, comments: 100 } as const

/** 按已保存的原始互动数量判断，不使用显示档位反推。 */
export function selectionReason(note: {
    likes: number | null
    collects: number | null
    comments: number | null
}): SelectionReason {
    return (Object.keys(HIGH_EXPOSURE) as (keyof typeof HIGH_EXPOSURE)[]).every(
        (metric) =>
            note[metric] != null &&
            Number.isFinite(note[metric]) &&
            note[metric]! >= HIGH_EXPOSURE[metric],
    )
        ? 'high_exposure'
        : 'rapid_growth'
}
