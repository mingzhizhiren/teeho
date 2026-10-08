import { z } from 'zod'

const structureCountSchema = z.number().int().nonnegative().nullable()
const MINIMUM_REFERENCE_SAMPLES = 3
const MAX_LOCATION_ITEMS = 1000
const MAX_LOCATION_TEXT = 1000
const locationSchema = z
    .object({ index: z.number().int().nonnegative(), text: z.string().max(MAX_LOCATION_TEXT) })
    .strict()
export const structureLocationsSchema = z
    .object({
        topics: z.array(locationSchema).max(MAX_LOCATION_ITEMS),
        paragraphs: z
            .array(locationSchema.extend({ number: z.number().int().positive() }))
            .max(MAX_LOCATION_ITEMS),
    })
    .strict()
export type StructureLocations = z.infer<typeof structureLocationsSchema>

/** 只接收报告保存的结构指标，不从当前任务重新计算历史值。 */
const currentStructureMetricsSchema = z
    .object({
        titleLength: structureCountSchema,
        bodyLength: structureCountSchema,
        paragraphLength: z.number().finite().nonnegative().nullable(),
        paragraphCount: structureCountSchema,
        topicCount: structureCountSchema,
        topicLength: z.number().finite().nonnegative().nullable(),
        maxTopicLength: structureCountSchema.optional(),
        maxParagraphLength: structureCountSchema.optional(),
    })
    .strict()

const savedLegacyMetricsSchema = currentStructureMetricsSchema
    .omit({ paragraphCount: true, topicLength: true })
    .extend({
        titleEmojiRatio: z.number().finite().min(0).max(1).nullable(),
        listItemCount: structureCountSchema,
    })
    .transform((saved) => ({
        titleLength: saved.titleLength,
        bodyLength: saved.bodyLength,
        paragraphLength: saved.paragraphLength,
        paragraphCount: null,
        topicCount: saved.topicCount,
        topicLength: null,
        maxTopicLength: undefined,
        maxParagraphLength: undefined,
    }))

/** 旧报告只保留原有值，缺少的新指标不补算。 */
export const structureMetricsSchema = z.union([
    currentStructureMetricsSchema,
    savedLegacyMetricsSchema,
])

export type StructureMetrics = z.infer<typeof structureMetricsSchema>

const structureReferenceSchema = z
    .object({
        low: z.number().finite().nonnegative(),
        high: z.number().finite().nonnegative(),
        sampleCount: z.number().int().min(MINIMUM_REFERENCE_SAMPLES),
        severity: z.enum(['aligned', 'minor', 'moderate', 'major', 'critical']),
    })
    .strict()
    .refine((value) => value.low <= value.high)
    .nullable()

/** 服务端冻结的同类优秀样本参考范围，缺少证据时保留 null。 */
const currentStructureReferencesSchema = z
    .object({
        titleLength: structureReferenceSchema,
        bodyLength: structureReferenceSchema,
        paragraphLength: structureReferenceSchema,
        paragraphCount: structureReferenceSchema,
        topicCount: structureReferenceSchema,
        topicLength: structureReferenceSchema,
        maxTopicLength: structureReferenceSchema.optional(),
        maxParagraphLength: structureReferenceSchema.optional(),
    })
    .strict()

const savedLegacyReferencesSchema = currentStructureReferencesSchema
    .omit({ paragraphCount: true, topicLength: true })
    .extend({
        titleEmojiRatio: structureReferenceSchema.refine(
            (value) => value === null || value.high <= 1,
        ),
        listItemCount: structureReferenceSchema,
    })
    .transform((saved) => ({
        titleLength: saved.titleLength,
        bodyLength: saved.bodyLength,
        paragraphLength: saved.paragraphLength,
        paragraphCount: null,
        topicCount: saved.topicCount,
        topicLength: null,
        maxTopicLength: undefined,
        maxParagraphLength: undefined,
    }))

/** 已保存的历史范围只迁移形状，不用当前样本重建。 */
export const structureReferencesSchema = z.union([
    currentStructureReferencesSchema,
    savedLegacyReferencesSchema,
])

export type StructureReferences = z.infer<typeof structureReferencesSchema>

/** 新报告八项顺序；旧报告由调用方过滤未保存的新字段。 */
export const structureMetricNames = [
    'titleLength',
    'bodyLength',
    'paragraphLength',
    'paragraphCount',
    'topicCount',
    'topicLength',
    'maxTopicLength',
    'maxParagraphLength',
] as const

export type StructureDifferenceState = 'within' | 'short' | 'long' | 'few' | 'many'

/** 差异文字描述保存值相对范围的位置，严重度只用于原有配色。 */
export function structureDifferenceState(
    metric: keyof StructureMetrics,
    value: number | null | undefined,
    reference: StructureReferences[keyof StructureMetrics],
): StructureDifferenceState | null {
    if (value == null || reference == null) return null
    if (value >= reference.low && value <= reference.high) return 'within'
    const isCount = metric === 'paragraphCount' || metric === 'topicCount'
    if (value < reference.low) return isCount ? 'few' : 'short'
    return isCount ? 'many' : 'long'
}
