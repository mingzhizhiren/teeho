import { z } from 'zod'

import type { AnalysisTrackDefinition } from './analysis.contract'
import { analysisUiConstraints } from './analysis.constants'

export const trackSelectionStorageKey = 'analysis.track-selection.v1'
export const persistedTrackSelectionSchema = z
    .object({
        trackId: z.string().min(1),
        customTrackName: z
            .string()
            .trim()
            .min(1)
            .max(analysisUiConstraints.customTrackNameMaxLength)
            .nullable(),
    })
    .strict()

export type PersistedTrackSelection = z.infer<typeof persistedTrackSelectionSchema>

function normalizeSearchText(value: string) {
    return value.normalize('NFKC').trim().toLocaleLowerCase()
}

function containsEitherDirection(left: string, right: string) {
    return left.includes(right) || right.includes(left)
}

/** 按本地化名称与后端关键词执行确定性的双向包含检索。 */
export function filterAnalysisTracks(
    tracks: readonly AnalysisTrackDefinition[],
    query: string,
    resolveName: (track: AnalysisTrackDefinition) => string,
) {
    const normalizedQuery = normalizeSearchText(query)
    if (!normalizedQuery) return [...tracks].sort((left, right) => left.order - right.order)

    const customTrack = tracks.find((track) => track.custom)
    const matches = tracks.filter((track) => {
        if (track.custom) return false
        return [resolveName(track), ...track.keywords]
            .map(normalizeSearchText)
            .some((candidate) => containsEitherDirection(candidate, normalizedQuery))
    })

    if (matches.length > 0) return matches.sort((left, right) => left.order - right.order)
    return customTrack ? [customTrack] : []
}
