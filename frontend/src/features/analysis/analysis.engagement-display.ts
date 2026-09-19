const ENGAGEMENT_TIERS = {
    likes: [
        { minimum: 100_000, label: '10W+' },
        { minimum: 10_000, label: '1W+' },
        { minimum: 1_000, label: '1K+' },
        { minimum: 100, label: '100+' },
    ],
    collects: [
        { minimum: 10_000, label: '1W+' },
        { minimum: 5_000, label: '5K+' },
        { minimum: 1_000, label: '1K+' },
        { minimum: 100, label: '100+' },
    ],
    comments: [
        { minimum: 1_000, label: '1000+' },
        { minimum: 100, label: '100+' },
        { minimum: 10, label: '10+' },
    ],
} as const

/** 参考笔记互动数量仅显示档位，缺失或低数量使用本地化提示。 */
export function formatEngagementTier(
    metric: keyof typeof ENGAGEMENT_TIERS,
    count: number | null | undefined,
    growingLabel: string,
): string {
    return (
        ENGAGEMENT_TIERS[metric].find(({ minimum }) => count != null && count >= minimum)?.label ??
        growingLabel
    )
}
