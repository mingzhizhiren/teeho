import { z } from 'zod'
import { extractStructureFeatures, type StructureFeatures } from '@teeho/content-metrics'
import type { AnalysisEvidenceSet } from '../evidence/analysis.evidence'
import type { StandardAnalysisTask } from '../analysis.schema'
import { contextSamples } from './analysis.radar-context'
import { excellentCheckupSamples } from './analysis.checkup.selection'

const countSchema = z.number().int().nonnegative().nullable()
const MINIMUM_REFERENCE_SAMPLES = 3
export const structureMetricsSchema = z
    .object({
        titleLength: countSchema,
        titleEmojiRatio: z.number().finite().min(0).max(1).nullable(),
        bodyLength: countSchema,
        paragraphLength: z.number().finite().nonnegative().nullable(),
        listItemCount: countSchema,
        topicCount: countSchema,
    })
    .strict()

const referenceSchema = z
    .object({
        low: z.number().finite().nonnegative(),
        high: z.number().finite().nonnegative(),
        sampleCount: z.number().int().min(MINIMUM_REFERENCE_SAMPLES),
        severity: z.enum(['aligned', 'minor', 'moderate', 'major', 'critical']),
    })
    .strict()
    .refine((value) => value.high >= value.low, 'Invalid reference range')
    .nullable()

export const structureReferencesSchema = z
    .object({
        titleLength: referenceSchema,
        titleEmojiRatio: referenceSchema.refine((value) => value === null || value.high <= 1),
        bodyLength: referenceSchema,
        paragraphLength: referenceSchema,
        listItemCount: referenceSchema,
        topicCount: referenceSchema,
    })
    .strict()
export type StructureReferences = z.infer<typeof structureReferencesSchema>

const LIMITS = {
    minimumSamples: MINIMUM_REFERENCE_SAMPLES,
    lowQuantile: 0.25,
    highQuantile: 0.75,
    spanFloor: 0.25,
    ratioStep: 0.01,
    countStep: 1,
    minorDeviation: 0.5,
    moderateDeviation: 1,
    majorDeviation: 2,
} as const

function quantile(values: readonly number[], probability: number): number {
    const ordered = [...values].sort((a, b) => a - b)
    const index = (ordered.length - 1) * probability
    const lower = Math.floor(index),
        upper = Math.ceil(index)
    return ordered[lower]! + (ordered[upper]! - ordered[lower]!) * (index - lower)
}

function compare(
    value: number,
    low: number,
    high: number,
    isRatio: boolean,
): NonNullable<StructureReferences['titleLength']>['severity'] {
    const distance = Math.max(0, low - value, value - high)
    const deviation =
        distance /
        Math.max(
            high - low,
            Math.abs(low) * LIMITS.spanFloor,
            isRatio ? LIMITS.ratioStep : LIMITS.countStep,
        )
    if (deviation === 0) return 'aligned'
    if (deviation <= LIMITS.minorDeviation) return 'minor'
    if (deviation <= LIMITS.moderateDeviation) return 'moderate'
    if (deviation <= LIMITS.majorDeviation) return 'major'
    return 'critical'
}

/** 同一优秀样本群体的结构Q25～Q75；颜色表示差异，不是内容质量分。 */
export function compareStructureMetrics(
    current: StructureFeatures,
    peers: readonly StructureFeatures[],
): StructureReferences {
    const keys = Object.keys(structureMetricsSchema.shape) as (keyof StructureFeatures)[]
    return structureReferencesSchema.parse(
        Object.fromEntries(
            keys.map((key) => {
                if (peers.length < LIMITS.minimumSamples) return [key, null]
                const values = peers.map((peer) => peer[key])
                const low = quantile(values, LIMITS.lowQuantile),
                    high = quantile(values, LIMITS.highQuantile)
                return [
                    key,
                    {
                        low,
                        high,
                        sampleCount: peers.length,
                        severity: compare(current[key], low, high, key === 'titleEmojiRatio'),
                    },
                ]
            }),
        ),
    )
}

/** 从与案例同口径的优秀样本提取全部六项参照，不使用正文截断片段。 */
export function calculateStructureReferences(
    evidence: AnalysisEvidenceSet,
    task: StandardAnalysisTask,
): StructureReferences {
    const metrics = extractStructureFeatures(
        task.fields.title.value,
        task.fields.body.value,
        task.fields.topics.value,
    )
    const { selected } = contextSamples(evidence, task)
    const peers = excellentCheckupSamples(selected).map(({ note }) =>
        extractStructureFeatures(note.title, note.body, note.topics),
    )
    return compareStructureMetrics(metrics, peers)
}
