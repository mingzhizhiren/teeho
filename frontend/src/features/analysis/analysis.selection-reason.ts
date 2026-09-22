import { formatEngagementTier } from './analysis.engagement-display'

/** 入选理由的稳定枚举值，文案由语言目录提供。 */
export const SELECTION_REASONS = ['high_exposure', 'rapid_growth'] as const
export type SelectionReason = (typeof SELECTION_REASONS)[number]
const HIGH_EXPOSURE = { likes: 10_000, collects: 1_000, comments: 100 } as const

interface ReferenceDisplayNote {
    readonly likes: number | null
    readonly collects: number | null
    readonly comments: number | null
    readonly reason: string
}
interface ReferenceDisplayLabels {
    readonly semanticReference?: string
    readonly selectionReasons?: Readonly<Record<SelectionReason, string>>
    readonly rapidGrowth: string
}
interface ReferencePresentation {
    readonly reason: string | null
    readonly counts: Readonly<Record<keyof typeof HIGH_EXPOSURE, string>>
}

/** 页面与复制共用入选理由和数量语义，数字格式由展示入口决定。 */
export function presentReference(
    note: ReferenceDisplayNote,
    labels: ReferenceDisplayLabels,
    formatCount: (value: number) => string = String,
): ReferencePresentation {
    const isSemantic = note.reason === 'semantic_similarity'
    const count = (metric: keyof typeof HIGH_EXPOSURE): string => {
        const value = note[metric]
        return isSemantic
            ? value === null
                ? '—'
                : formatCount(value)
            : formatEngagementTier(metric, value, labels.rapidGrowth)
    }
    return {
        reason: isSemantic
            ? (labels.semanticReference ?? null)
            : (labels.selectionReasons?.[selectionReason(note)] ?? null),
        counts: { likes: count('likes'), collects: count('collects'), comments: count('comments') },
    }
}

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
