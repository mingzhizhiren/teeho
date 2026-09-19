import { createHash } from 'node:crypto'
import { checkupSampling } from '../analysis/checkup/analysis.checkup.constants'
import { compareCheckupObservations } from '../analysis/checkup/analysis.checkup.selection'
import { checkupTopicSchema } from '../analysis/checkup/analysis.checkup.topics'
import {
    analysisEvidenceNoteSchema,
    analysisEvidenceSetSchema,
} from '../analysis/evidence/analysis.evidence'
import { hasComparableIntent } from '../analysis/tracks/analysis.intent'
import { sampleByTrack } from '../analysis/tracks/analysis.track-sampling'
import {
    analysisTrackWeights,
    normalizeAnalysisTrackSelection,
} from '../analysis/tracks/analysis.track-selection'
import { resolveAnalysisTrackCode } from '../analysis/tracks/analysis.tracks'
import { z, type DataSource } from './contract'

const rawNote = analysisEvidenceNoteSchema.omit({
    observedAt: true,
    createdAt: true,
    selectionScore: true,
    topicMatched: true,
})
const datasetSchema = z
    .object({
        notes: z.array(rawNote),
        topics: z.array(checkupTopicSchema).default([]),
        extensions: analysisEvidenceSetSchema.shape.extensions,
    })
    .strict()
export interface JsonSourceOptions {
    readonly id: string
    readonly read: (signal: AbortSignal) => Promise<unknown>
    readonly extensions?: DataSource['extensions']
}

/** JSON 表达事实，运行时身份及截止窗口由适配器形成。 */
export function createJsonSource(options: JsonSourceOptions): DataSource {
    const load = async (signal: AbortSignal) => {
        signal.throwIfAborted()
        const data = datasetSchema.parse(await options.read(signal))
        signal.throwIfAborted()
        return data
    }
    return {
        id: options.id,
        version: '1',
        extensions: options.extensions,
        async load(input) {
            const data = await load(input.signal)
            const asOf = input.asOf ?? new Date().toISOString()
            const trackCode = resolveAnalysisTrackCode(input.task.fields.track.value)
            const selection = normalizeAnalysisTrackSelection(trackCode, input.task.secondaryTracks)
            const selectedCodes = analysisTrackWeights(selection).map((track) => track.trackCode)
            const cutoff = Date.parse(asOf)
            const candidates = data.notes
                .filter(
                    (note) =>
                        Date.parse(note.publishedAt) <= cutoff &&
                        (!note.noteType ||
                            note.noteType ===
                                (input.task.contentKind === 'video' ? 'video' : 'normal')) &&
                        hasComparableIntent(note.title, note.body, input.task.analysisIntent) &&
                        (!note.trackCodes ||
                            note.trackCodes.some((code) => selectedCodes.includes(code))),
                )
                .flatMap((note) => {
                    const observations = note.observations
                        .filter((item) => Date.parse(item.observedAt) <= cutoff)
                        .sort(compareCheckupObservations)
                    const latest = observations[0]
                    if (!latest || latest.likes === null || latest.collects === null) return []
                    const observedAt = new Date(
                        Math.max(...observations.map((item) => Date.parse(item.observedAt))),
                    ).toISOString()
                    const facts = note
                    return [
                        analysisEvidenceNoteSchema.parse({
                            ...facts,
                            observations,
                            observedAt,
                            createdAt: note.publishedAt,
                            selectionScore: 0,
                            topicMatched: false,
                        }),
                    ]
                })
            const notes = sampleByTrack(
                candidates,
                selection,
                checkupSampling.candidateLimit,
                (note) => note,
            )
            return analysisEvidenceSetSchema.parse({
                schemaVersion: 'analysis-evidence.v3',
                sourceVersion: `${options.id}.v1`,
                evidenceVersion: createHash('sha256')
                    .update(JSON.stringify({ asOf, selection, notes, extensions: data.extensions }))
                    .digest('hex'),
                selectedAt: asOf,
                selectionCriteria: {
                    trackCode,
                    secondaryTracks: [...selection.secondaryTracks],
                    searchTerms: [],
                    dataAnchor: notes.length
                        ? new Date(
                              Math.max(...notes.map((note) => Date.parse(note.observedAt))),
                          ).toISOString()
                        : null,
                    selectionVersion: 'json.v2',
                    algorithmVersion: 'independent',
                },
                matchedNoteCount: 0,
                aggregate: {
                    totalNoteCount: notes.length,
                    matchedNoteCount: 0,
                    matchedAuthorCount: 0,
                },
                notes,
                extensions: data.extensions,
            })
        },
        async loadTopics(input) {
            const data = await load(input.signal)
            const topics = data.topics.filter(
                (topic) => Date.parse(topic.observedAt) <= Date.parse(input.asOf),
            )
            return { status: topics.length ? 'collected' : 'no_sources', asOf: input.asOf, topics }
        },
    }
}
