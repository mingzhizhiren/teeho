import { z } from 'zod'

/** 分类身份与取样比例由宿主决定，Agent 只负责主次选择。 */
export const TRACK_SELECTION = {
    maximumCode: 30,
    maximumSecondary: 3,
    primaryWeight: 0.6,
    secondaryWeight: 0.4,
} as const
export const secondaryTrackCodesSchema = z
    .array(z.number().int().min(1).max(TRACK_SELECTION.maximumCode))
    .max(TRACK_SELECTION.maximumSecondary)
export interface AnalysisTrackSelection {
    readonly primaryTrack: number
    readonly secondaryTracks: readonly number[]
}
export interface AnalysisTrackWeight {
    readonly trackCode: number
    readonly weight: number
}

/** 无合法主赛道时整体回退；次赛道只保留合法、去重后的前三个。 */
export function normalizeAnalysisTrackSelection(
    primary: unknown,
    secondary: unknown,
): AnalysisTrackSelection {
    if (
        typeof primary !== 'number' ||
        !Number.isInteger(primary) ||
        primary < 1 ||
        primary > TRACK_SELECTION.maximumCode
    )
        return { primaryTrack: 0, secondaryTracks: [] }
    const candidates = Array.isArray(secondary) ? secondary : []
    return {
        primaryTrack: primary,
        secondaryTracks: [
            ...new Set(
                candidates.filter(
                    (code): code is number =>
                        typeof code === 'number' &&
                        Number.isInteger(code) &&
                        code >= 1 &&
                        code <= TRACK_SELECTION.maximumCode &&
                        code !== primary,
                ),
            ),
        ].slice(0, TRACK_SELECTION.maximumSecondary),
    }
}

/** 只有主赛道时为100%；否则主60%，剩余40%由实际次赛道均分。 */
export function analysisTrackWeights(
    selection: AnalysisTrackSelection,
): readonly AnalysisTrackWeight[] {
    const normalized = normalizeAnalysisTrackSelection(
        selection.primaryTrack,
        selection.secondaryTracks,
    )
    if (!normalized.secondaryTracks.length)
        return [{ trackCode: normalized.primaryTrack, weight: 1 }]
    return [
        { trackCode: normalized.primaryTrack, weight: TRACK_SELECTION.primaryWeight },
        ...normalized.secondaryTracks.map((trackCode) => ({
            trackCode,
            weight: TRACK_SELECTION.secondaryWeight / normalized.secondaryTracks.length,
        })),
    ]
}
