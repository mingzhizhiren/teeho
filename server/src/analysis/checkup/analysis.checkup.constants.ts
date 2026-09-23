/** 算法及评分口径的单一版本来源。 */
export const checkupVersions = {
    algorithm: 'radar-rules.v120.2',
    selection: 'checkup-selection.v7',
    score: 'insight-consistency-score.v2',
    explanation: 'content-analysis.v4',
} as const

/** 候选数据按发布时间逐段扩展的窗口。 */
const CHECKUP_WINDOW_DAYS = {
    initial: 1,
    expanded: 7,
    maximum: 30,
} as const

/** 体检输入、报告与评分的版本化常量。 */
export const checkupOutputConstraints = {
    maximumTrackCode: 30,
    referenceNearDifference: 0.5,
    insightMaximumScore: 10,
    maximumScore: 100,
    minimumScore: 0,
    summaryMaxLength: 800,
    itemMaxLength: 500,
    maxStrengths: 6,
    maxRisks: 12,
    maxUncertainties: 12,
    maxReferences: 4,
    maxDifferences: 3,
    referenceTitleMaxLength: 80,
    excerptMaxLength: 300,
    decimalScale: 100,
    decimalPlaces: 2,
    roundingPrecision: 12,
} as const

/** 私有笔记比较的明确资源和时效边界。 */
export const checkupSampling = {
    windowsDays: [
        CHECKUP_WINDOW_DAYS.initial,
        CHECKUP_WINDOW_DAYS.expanded,
        CHECKUP_WINDOW_DAYS.maximum,
    ],
    candidateLimit: 1000,
    // 仅标记词面主题匹配供审计；参考资格不再由该阈值决定。
    minimumSimilarity: 0.1,
    observationMaxAgeDays: 30,
    dayMs: 86_400_000,
    tokenLimit: 512,
    evidenceBodyMaxLength: 10_000,
} as const

/** 固定词项、相似度和标题表达指标的数学定义。 */
export const checkupTextComparison = {
    hanTermWidth: 2,
    diceIntersectionMultiplier: 2,
    titleExpressionComponentCount: 2,
} as const
