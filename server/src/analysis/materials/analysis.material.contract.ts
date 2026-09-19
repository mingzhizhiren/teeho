import { z } from 'zod'
import {
    normalizeAnalysisTrackSelection,
    secondaryTrackCodesSchema,
} from '../tracks/analysis.track-selection'

export const MATERIAL_LIMITS = { description: 1800, summary: 4000, maximumTrack: 30 } as const
export const materialPromptVersions = {
    cover: 'material-cover.v2',
    content: 'material-content.v2',
    classification: 'material-classification.v3',
} as const
export const materialDescriptionSchema = z
    .object({ description: z.string().trim().min(1).max(MATERIAL_LIMITS.description) })
    .strict()
export const materialClassificationSchema = z
    .object({
        primaryTrack: z.number().int().min(0).max(MATERIAL_LIMITS.maximumTrack),
        secondaryTracks: secondaryTrackCodesSchema.optional(),
        intent: z.enum(['daily', 'guide', 'story', 'review', 'other']),
    })
    .strict()
/** Provider 声明允许未分类与多给次赛道，由宿主统一归一化后再保存。 */
export const materialClassificationProviderSchema = materialClassificationSchema.extend({
    primaryTrack: materialClassificationSchema.shape.primaryTrack.nullable(),
    secondaryTracks: z.array(z.number().int().min(1).max(MATERIAL_LIMITS.maximumTrack)),
})
export const understoodMaterialsSchema = z
    .object({
        cover: materialDescriptionSchema.shape.description,
        content: materialDescriptionSchema.shape.description.nullable(),
        primaryTrack: z.number().int().min(0).max(MATERIAL_LIMITS.maximumTrack),
        secondaryTracks: secondaryTrackCodesSchema.optional(),
        intent: materialClassificationSchema.shape.intent,
    })
    .strict()
export type UnderstoodMaterials = z.infer<typeof understoodMaterialsSchema>

/** 分类边界容忍多给、漏给和非法赛道，不将次赛道提升为主赛道。 */
export function normalizeMaterialClassification(
    value: unknown,
): z.infer<typeof materialClassificationSchema> {
    const object = z
        .object({
            primaryTrack: z.unknown().optional(),
            secondaryTracks: z.unknown().optional(),
            intent: z.unknown().optional(),
        })
        .safeParse(value)
    const selection = normalizeAnalysisTrackSelection(
        object.success ? object.data.primaryTrack : null,
        object.success ? object.data.secondaryTracks : null,
    )
    const intent = materialClassificationSchema.shape.intent.safeParse(
        object.success ? object.data.intent : null,
    )
    return {
        ...selection,
        secondaryTracks: [...selection.secondaryTracks],
        intent: intent.success ? intent.data : 'other',
    }
}
