/** 可选主分实现的输入契约；模型、参数和训练流程由部署方提供。 */
export interface InsightNote {
    title: string
    body: string
    topics: readonly string[]
    cover: string | null
    contentType: 'image' | 'video'
    publishedAt: string
}

interface ScoreReference {
    trackCode: number
    sampleCount: number
    mean: number
    median: number
    min?: number | null
    max?: number | null
    p10: number
    p90: number
}

export interface InsightRuntimePrediction {
    status: 'available' | 'unavailable'
    baseScore: number | null
    score: number | null
    coverage: number
    limited: boolean
    modelId: string | null
    reference:
        | (ScoreReference & {
              aggregation?: 'single_track' | 'weighted_tracks'
              components?: (ScoreReference & { weight: number })[]
          })
        | null
    scoringMode?: 'legacy_shared' | 'track_conditioned'
    tracks?: { trackCode: number; weight: number; score: number }[]
}

export type InsightPredictor = (
    note: InsightNote,
    asOf: string,
    trackCode?: number,
    secondaryTracks?: readonly number[],
) => Promise<InsightRuntimePrediction>

let predictor: InsightPredictor | undefined

/** 装配可选的主分实现；默认只使用插件六维平均分。 */
export function configureInsightPredictor(value: InsightPredictor): void {
    predictor = value
}

export const predictInsight: InsightPredictor = (...args) => {
    if (!predictor) throw new Error('Insight scoring is enabled but no predictor was configured')
    return predictor(...args)
}
