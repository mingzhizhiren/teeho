import { z } from 'zod'
import {
    extractStructureFeatures,
    STRUCTURE_KEYS,
    type StructureFeatures,
} from '@teeho/content-metrics'
import type { AnalysisEvidenceSet } from '../evidence/analysis.evidence'
import type { StandardAnalysisTask } from '../analysis.schema'
import { contextSamples } from './analysis.radar-context'
import { excellentCheckupSamples } from './analysis.checkup.selection'

const countSchema = z.number().int().nonnegative().nullable()
const MINIMUM_REFERENCE_SAMPLES = 3
const currentStructureMetricsSchema = z
    .object({
        titleLength: countSchema,
        bodyLength: countSchema,
        paragraphLength: z.number().finite().nonnegative().nullable(),
        paragraphCount: countSchema,
        topicLength: z.number().finite().nonnegative().nullable(),
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

const currentStructureReferencesSchema = z
    .object({
        titleLength: referenceSchema,
        bodyLength: referenceSchema,
        paragraphLength: referenceSchema,
        paragraphCount: referenceSchema,
        topicLength: referenceSchema,
        topicCount: referenceSchema,
    })
    .strict()
/** 旧报告只保留已保存的四项，新增指标为空，不重新计算历史。 */
const legacyMetricsSchema = currentStructureMetricsSchema
    .omit({ paragraphCount: true, topicLength: true })
    .extend({
        titleEmojiRatio: z.number().finite().min(0).max(1).nullable(),
        listItemCount: countSchema,
    })
    .strict()
    .transform((saved) => ({
        titleLength: saved.titleLength,
        bodyLength: saved.bodyLength,
        paragraphLength: saved.paragraphLength,
        topicCount: saved.topicCount,
        paragraphCount: null,
        topicLength: null,
    }))

const legacyReferencesSchema = currentStructureReferencesSchema
    .omit({ paragraphCount: true, topicLength: true })
    .extend({
        titleEmojiRatio: referenceSchema.refine((value) => value === null || value.high <= 1),
        listItemCount: referenceSchema,
    })
    .strict()
    .transform((saved) => ({
        titleLength: saved.titleLength,
        bodyLength: saved.bodyLength,
        paragraphLength: saved.paragraphLength,
        topicCount: saved.topicCount,
        paragraphCount: null,
        topicLength: null,
    }))

export const structureMetricsSchema = z.union([currentStructureMetricsSchema, legacyMetricsSchema])
export const structureReferencesSchema = z.union([
    currentStructureReferencesSchema,
    legacyReferencesSchema,
])
export type StructureReferences = z.infer<typeof structureReferencesSchema>

const LIMITS = {
    minimumSamples: MINIMUM_REFERENCE_SAMPLES,
    lowQuantile: 0.25,
    highQuantile: 0.75,
    spanFloor: 0.25,
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
): NonNullable<StructureReferences['titleLength']>['severity'] {
    const distance = Math.max(0, low - value, value - high)
    const deviation =
        distance / Math.max(high - low, Math.abs(low) * LIMITS.spanFloor, LIMITS.countStep)
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
    const keys = STRUCTURE_KEYS
    return structureReferencesSchema.parse(
        Object.fromEntries(
            keys.map((key) => {
                const values = peers.flatMap((peer) => (peer[key] === null ? [] : [peer[key]!]))
                if (current[key] === null || values.length < LIMITS.minimumSamples)
                    return [key, null]
                const low = quantile(values, LIMITS.lowQuantile),
                    high = quantile(values, LIMITS.highQuantile)
                return [
                    key,
                    {
                        low,
                        high,
                        sampleCount: values.length,
                        severity: compare(current[key]!, low, high),
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
