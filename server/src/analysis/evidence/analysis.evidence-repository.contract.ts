import type { DailyStats } from './analysis.daily-stats'

export interface AnalysisEvidenceComment {
    content: string
    likes: number | null
}

/** 真实证据源用于排序的最新笔记候选。 */
export interface AnalysisEvidenceCandidate {
    noteUrl?: string | null
    shares?: number | null
    noteId: string
    authorId: string
    title: string
    body: string
    topics: string[]
    publishedAt: string
    createdAt: string
    observedAt: string
    observationId?: string
    noteType?: 'normal' | 'video'
    contentObservedAt?: string | null
    firstImportedAt?: string | null
    fans?: number | null
    authorObservedAt?: string | null
    coverDescription?: string | null
    modelTrackCode?: number | null
    coverSha?: string | null
    coverObservedAt?: string | null
    coverWidth?: number | null
    coverHeight?: number | null
    likes: number | null
    collects: number | null
    comments: number | null
    topComments?: AnalysisEvidenceComment[]
    topicMatched: boolean
}

/** 同一笔记用于计算增量的历史观察。 */
export interface AnalysisEvidenceObservation {
    shares?: number | null
    noteId: string
    observationId?: string
    observedAt: string
    likes: number | null
    collects: number | null
    comments: number | null
}

export interface FindAnalysisEvidenceCandidatesInput {
    trackCode: number
    searchTerms: string[]
    observedAtOrBefore: string
    limit: number
    noteType?: 'normal' | 'video'
    publishedAfter?: string
    publishedBefore?: string
    observedAfter?: string
    observedBefore?: string
}

/** 真实笔记数据访问边界。 */
export interface AnalysisEvidenceRepository {
    findDailyStats?(trackCode: number, asOf: string): Promise<DailyStats[]>
    findCandidates(input: FindAnalysisEvidenceCandidatesInput): Promise<AnalysisEvidenceCandidate[]>
    findObservations(
        noteIds: string[],
        trackCode: number,
        observedAtOrBefore: string,
    ): Promise<AnalysisEvidenceObservation[]>
}
