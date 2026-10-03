import { z } from 'zod'

const structureCountSchema = z.number().int().nonnegative().nullable()
const MINIMUM_REFERENCE_SAMPLES = 3

/** 只接收报告保存的结构指标，不从当前任务重新计算历史值。 */
const currentStructureMetricsSchema = z
    .object({
        titleLength: structureCountSchema,
        bodyLength: structureCountSchema,
        paragraphLength: z.number().finite().nonnegative().nullable(),
        paragraphCount: structureCountSchema,
        topicCount: structureCountSchema,
        topicLength: z.number().finite().nonnegative().nullable(),
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
    }))

/** 已保存的历史范围只迁移形状，不用当前样本重建。 */
export const structureReferencesSchema = z.union([
    currentStructureReferencesSchema,
    savedLegacyReferencesSchema,
])

export type StructureReferences = z.infer<typeof structureReferencesSchema>

/** 与训练输入对应的六项用户可见指标顺序。 */
export const structureMetricNames = [
    'titleLength',
    'bodyLength',
    'paragraphLength',
    'paragraphCount',
    'topicCount',
    'topicLength',
] as const

export type StructureDifferenceState = 'within' | 'short' | 'long' | 'few' | 'many'

/** 差异文字描述保存值相对范围的位置，严重度只用于原有配色。 */
export function structureDifferenceState(
    metric: keyof StructureMetrics,
    value: number | null,
    reference: StructureReferences[keyof StructureMetrics],
): StructureDifferenceState | null {
    if (value === null || reference === null) return null
    if (value >= reference.low && value <= reference.high) return 'within'
    const isCount = metric === 'paragraphCount' || metric === 'topicCount'
    if (value < reference.low) return isCount ? 'few' : 'short'
    return isCount ? 'many' : 'long'
}
