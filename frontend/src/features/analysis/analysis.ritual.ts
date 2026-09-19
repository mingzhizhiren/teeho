export const ANALYSIS_RITUAL_VARIANTS = ['A', 'B', 'C'] as const

/** 分析动画的稳定方案标识。 */
export type AnalysisRitualVariant = (typeof ANALYSIS_RITUAL_VARIANTS)[number]

/** 为一次新的分析展示随机选择动画，并允许测试注入确定性随机源。 */
export function selectAnalysisRitualVariant(
    random: () => number = Math.random,
): AnalysisRitualVariant {
    const selectedIndex = Math.floor(random() * ANALYSIS_RITUAL_VARIANTS.length)
    return ANALYSIS_RITUAL_VARIANTS[selectedIndex] ?? ANALYSIS_RITUAL_VARIANTS[0]
}
