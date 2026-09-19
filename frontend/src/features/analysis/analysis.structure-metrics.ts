import { z } from 'zod'

const structureCountSchema = z.number().int().nonnegative().nullable()
const MINIMUM_REFERENCE_SAMPLES = 3

/** 只接收报告保存的结构指标，不从当前任务重新计算历史值。 */
export const structureMetricsSchema = z
    .object({
        titleLength: structureCountSchema,
        titleEmojiRatio: z.number().finite().min(0).max(1).nullable(),
        bodyLength: structureCountSchema,
        paragraphLength: z.number().finite().nonnegative().nullable(),
        listItemCount: structureCountSchema,
        topicCount: structureCountSchema,
    })
    .strict()

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
export const structureReferencesSchema = z
    .object({
        titleLength: structureReferenceSchema,
        titleEmojiRatio: structureReferenceSchema.refine(
            (value) => value === null || value.high <= 1,
        ),
        bodyLength: structureReferenceSchema,
        paragraphLength: structureReferenceSchema,
        listItemCount: structureReferenceSchema,
        topicCount: structureReferenceSchema,
    })
    .strict()

export type StructureReferences = z.infer<typeof structureReferencesSchema>

/** 与训练输入对应的六项用户可见指标顺序。 */
export const structureMetricNames = [
    'titleLength',
    'titleEmojiRatio',
    'bodyLength',
    'paragraphLength',
    'listItemCount',
    'topicCount',
] as const
