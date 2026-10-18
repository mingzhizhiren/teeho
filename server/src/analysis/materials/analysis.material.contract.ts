import { z } from 'zod'
import {
    normalizeAnalysisTrackSelection,
    secondaryTrackCodesSchema,
} from '../tracks/analysis.track-selection'

export const MATERIAL_LIMITS = { description: 1800, summary: 4000, maximumTrack: 30 } as const
export const materialPromptVersions = {
    cover: 'material-cover.v2',
    content: 'material-content.v2',
    classification: 'material-classification.v4',
} as const
export const materialDescriptionSchema = z
    .object({ description: z.string().trim().min(1).max(MATERIAL_LIMITS.description) })
    .strict()
export const materialClassificationSchema = z
    .object({
        primaryTrack: z.number().int().min(1).max(MATERIAL_LIMITS.maximumTrack),
        secondaryTracks: secondaryTrackCodesSchema.optional(),
        intent: z.enum(['daily', 'guide', 'story', 'review', 'other']),
    })
    .strict()
/** Provider 必须选择有效主赛道；多给的次赛道由宿主归一化。 */
export const materialClassificationProviderSchema = materialClassificationSchema.extend({
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

/** 主赛道必须有效；次赛道仍容忍多给、漏给和非法值，不提升为主赛道。 */
export function normalizeMaterialClassification(
    value: unknown,
): z.infer<typeof materialClassificationSchema> {
    const object = z
        .object({
            primaryTrack: materialClassificationSchema.shape.primaryTrack,
            secondaryTracks: z.unknown().optional(),
            intent: z.unknown().optional(),
        })
        .parse(value)
    const selection = normalizeAnalysisTrackSelection(object.primaryTrack, object.secondaryTracks)
    const intent = materialClassificationSchema.shape.intent.safeParse(object.intent)
    return {
        ...selection,
        secondaryTracks: [...selection.secondaryTracks],
        intent: intent.success ? intent.data : 'other',
    }
}
