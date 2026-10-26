/** 算法及评分口径的单一版本来源。 */
export const checkupVersions = {
    algorithm: 'radar-rules.v120.2',
    selection: 'checkup-selection.v10',
    score: 'insight-structure-consistency-score.v4',
    explanation: 'content-analysis.v6',
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
    maxReferences: 10,
    maxDifferences: 3,
    referenceTitleMaxLength: 80,
    excerptMaxLength: 300,
    decimalScale: 100,
    decimalPlaces: 2,
    roundingPrecision: 12,
} as const

/** 私有笔记比较的明确资源和时效边界。 */
export const checkupSampling = {
    // 未启用模型优秀集合的旧路径仍展示四篇，不因报告容量扩大而改变选样。
    legacyReferenceLimit: 4,
    candidateLimit: 50,
    // 仅标记词面主题匹配供审计；参考资格不再由该阈值决定。
    minimumSimilarity: 0.1,
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
