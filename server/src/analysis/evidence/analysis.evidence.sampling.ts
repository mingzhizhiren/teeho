import { checkupSampling } from '../checkup/analysis.checkup.constants'
import { hasComparableIntent, type inferNoteIntent } from '../tracks/analysis.intent'
import { sampleByTrack } from '../tracks/analysis.track-sampling'
import {
    analysisTrackWeights,
    type AnalysisTrackSelection,
} from '../tracks/analysis.track-selection'
import type {
    AnalysisEvidenceCandidate,
    AnalysisEvidenceRepository,
} from './analysis.evidence-repository.contract'

type TaggedCandidate = AnalysisEvidenceCandidate & { readonly trackCodes: readonly number[] }
interface CandidateInput {
    readonly repository: AnalysisEvidenceRepository
    readonly selection: AnalysisTrackSelection
    readonly searchTerms: string[]
    readonly asOf: string
    readonly noteType: 'normal' | 'video'
    readonly signal: AbortSignal
    readonly intent?: ReturnType<typeof inferNoteIntent>
}

function eligible(note: AnalysisEvidenceCandidate, asOf: string): boolean {
    return (
        Number.isSafeInteger(note.likes) &&
        Number.isSafeInteger(note.collects) &&
        note.likes! >= 0 &&
        note.collects! >= 0 &&
        Date.parse(note.publishedAt) <= Date.parse(asOf) &&
        Date.parse(note.observedAt) >= Date.parse(note.publishedAt) &&
        Date.parse(note.observedAt) <= Date.parse(asOf)
    )
}

async function loadTrack(input: CandidateInput, trackCode: number): Promise<TaggedCandidate[]> {
    const found = await input.repository.findCandidates({
        trackCode,
        searchTerms: input.searchTerms,
        observedAtOrBefore: input.asOf,
        noteType: input.noteType,
        limit: checkupSampling.candidateLimit,
    })
    input.signal.throwIfAborted()
    return [
        ...new Map(
            [
                ...found
                    .filter(
                        (note) =>
                            eligible(note, input.asOf) &&
                            hasComparableIntent(note.title, note.body, input.intent),
                    )
                    .map((note) => ({ ...note, trackCodes: [trackCode] })),
            ].map((note) => [note.noteId, note]),
        ).values(),
    ].slice(0, checkupSampling.candidateLimit)
}

/** 每个赛道独立取有界候选，再合并身份、按权重分配全局名额。 */
export async function loadTrackCandidates(input: CandidateInput): Promise<TaggedCandidate[]> {
    const merged = new Map<string, TaggedCandidate>()
    for (const { trackCode } of analysisTrackWeights(input.selection)) {
        input.signal.throwIfAborted()
        for (const note of await loadTrack(input, trackCode)) {
            const previous = merged.get(note.noteId)
            merged.set(note.noteId, {
                ...previous,
                ...note,
                trackCodes: [...new Set([...(previous?.trackCodes ?? []), ...note.trackCodes])],
            })
        }
    }
    return sampleByTrack(
        [...merged.values()],
        input.selection,
        checkupSampling.candidateLimit,
        (note) => note,
    )
}
