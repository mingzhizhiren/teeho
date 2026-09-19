import { z } from 'zod'
import type { StandardAnalysisTask } from '../analysis.schema'
import type { AnalysisEvidenceSet } from '../evidence/analysis.evidence'
import type { CheckupReference } from './analysis.checkup.contract'
import { excellentCheckupSamples } from './analysis.checkup.selection'
import { noteTextFeatures, type NoteTextFeatures } from './analysis.note-features'
import { radarMetricNames } from './analysis.radar'
import { contextSamples } from './analysis.radar-context'

const MAX_REFERENCES = 3
const MINOR_DEVIATION = 0.5
const MAJOR_DEVIATION = 2
export const differenceSeverities = ['aligned', 'minor', 'moderate', 'major', 'critical'] as const
export const differenceSchema = z
    .object({
        id: z.string(),
        metric: z.enum(radarMetricNames),
        feature: z.enum([
            'titleLength',
            'bodyLength',
            'paragraphs',
            'paragraphLength',
            'lexicalVariety',
        ]),
        value: z.number().finite(),
        low: z.number().finite(),
        high: z.number().finite(),
        severity: z.enum(differenceSeverities),
        referenceIds: z.array(z.string()).min(1).max(MAX_REFERENCES),
    })
    .strict()
export type NoteDifference = z.infer<typeof differenceSchema>
interface FeatureEvidence {
    noteId: string
    values: NoteTextFeatures
}
const RULES = {
    maxItems: 3,
    low: 0.25,
    high: 0.75,
    floor: 0.25,
    boundaries: [0, MINOR_DEVIATION, 1, MAJOR_DEVIATION],
} as const
const features = [
    { feature: 'titleLength', metric: 'titleExpression' },
    { feature: 'bodyLength', metric: 'contentDevelopment' },
    { feature: 'paragraphLength', metric: 'readingExperience' },
    { feature: 'lexicalVariety', metric: 'distinctiveness' },
] as const
function quantile(values: readonly number[], probability: number): number {
    const sorted = [...values].sort((a, b) => a - b)
    const index = (sorted.length - 1) * probability
    return (
        sorted[Math.floor(index)]! +
        (sorted[Math.ceil(index)]! - sorted[Math.floor(index)]!) * (index - Math.floor(index))
    )
}

/** 差异基于可比较特征，不由雷达低分或Agent判断反推风险。 */
export function calculateDifferences(
    evidence: AnalysisEvidenceSet,
    task: StandardAnalysisTask,
    references: readonly CheckupReference[],
): NoteDifference[] {
    const { selected } = contextSamples(evidence, task)
    if (!selected.length || !references.length) return []
    const peers = excellentCheckupSamples(selected).map(({ note }) => ({
        noteId: note.noteId,
        values: noteTextFeatures(note.title, note.body),
    }))
    const user = noteTextFeatures(task.fields.title.value, task.fields.body.value)
    return features
        .flatMap(({ feature, metric }) =>
            describeDifference(feature, metric, user, peers, references),
        )
        .sort(
            (a, b) =>
                differenceSeverities.indexOf(b.severity) - differenceSeverities.indexOf(a.severity),
        )
        .slice(0, RULES.maxItems)
}

function describeDifference(
    feature: (typeof features)[number]['feature'],
    metric: (typeof features)[number]['metric'],
    user: NoteTextFeatures,
    peers: readonly FeatureEvidence[],
    references: readonly CheckupReference[],
): NoteDifference[] {
    const values = peers.map((peer) => peer.values[feature])
    const low = quantile(values, RULES.low),
        high = quantile(values, RULES.high)
    const referenceIds = references
        .filter((reference) => {
            const value = peers.find((peer) => peer.noteId === reference.noteId)?.values[feature]
            return value !== undefined && value >= low && value <= high
        })
        .map((reference) => reference.noteId)
        .slice(0, RULES.maxItems)
    if (!referenceIds.length) return []
    const distance = Math.max(
        0,
        low - user[feature],
        feature === 'lexicalVariety' ? 0 : user[feature] - high,
    )
    const deviation = distance / Math.max(1, high - low, Math.abs(low) * RULES.floor)
    const index = RULES.boundaries.findIndex((limit) => deviation <= limit)
    return [
        {
            id: feature,
            metric,
            feature,
            value: user[feature],
            low,
            high,
            severity: index < 0 ? 'critical' : differenceSeverities[index]!,
            referenceIds,
        },
    ]
}
