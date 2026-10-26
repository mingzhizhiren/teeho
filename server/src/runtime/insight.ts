/** 可选主分实现的输入契约；模型、参数和训练流程由部署方提供。 */
export interface InsightNote {
    title: string
    body: string
    topics: readonly string[]
    cover: string | null
    contentType: 'image' | 'video'
    imageCount?: number | null
    videoDurationSeconds?: number | null
    /** Asia/Shanghai 自然日，格式 YYYY-MM-DD。 */
    publishedAt: string
}

interface ScoreReference {
    contentType?: 'image' | 'video'
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
    featureEncoding?: 'semantic'
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
    signal?: AbortSignal,
) => Promise<InsightRuntimePrediction>

let predictor: InsightPredictor | undefined
const publicationDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' })

/** 参考证据的时间戳统一转换为评分契约要求的自然日。 */
export function formatInsightPublicationDate(instant: string): string {
    return publicationDateFormatter.format(new Date(instant))
}

/** 装配可选的主分实现；默认只使用插件六维平均分。 */
export function configureInsightPredictor(value: InsightPredictor): void {
    predictor = value
}

export const predictInsight: InsightPredictor = (...args) => {
    if (!predictor) throw new Error('Insight scoring is enabled but no predictor was configured')
    return predictor(...args)
}
