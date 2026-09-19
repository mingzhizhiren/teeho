import { z } from 'zod'

import type { AnalysisDraft } from '../analysis.schema'

/** 正式分析受理请求携带的确认、会话、素材与幂等边界。 */
export const analysisTaskAdmissionSchema = z
    .object({
        schemaVersion: z.literal('analysis-task-admission.v1'),
        confirmationRevision: z.number().int().nonnegative(),
        session: z
            .object({
                sessionId: z.string().uuid(),
                generation: z.number().int().positive(),
                browserInstanceId: z.string().uuid(),
            })
            .strict()
            .nullable(),
        mediaBinding: z
            .object({
                contentKind: z.enum(['text', 'image', 'video']),
                imageReferences: z.array(z.string().uuid()),
                videoReference: z.string().uuid().nullable(),
                coverReference: z.string().uuid().nullable().optional(),
            })
            .strict(),
        idempotencyKey: z.string().uuid(),
    })
    .strict()

export type AnalysisTaskAdmission = z.infer<typeof analysisTaskAdmissionSchema>

/** 素材绑定必须与本次被冻结草稿逐项一致，不能复用旧确认版本的素材。 */
export function analysisTaskAdmissionMatchesDraft(
    admission: AnalysisTaskAdmission,
    draft: AnalysisDraft,
) {
    const expectedContentKind = draft.videoReference
        ? 'video'
        : draft.imageReferences.length > 0
          ? 'image'
          : 'text'
    return (
        admission.mediaBinding.contentKind === expectedContentKind &&
        admission.mediaBinding.videoReference === (draft.videoReference ?? null) &&
        (admission.mediaBinding.coverReference ??
            admission.mediaBinding.imageReferences[0] ??
            null) === (draft.coverReference ?? draft.imageReferences[0] ?? null) &&
        admission.mediaBinding.imageReferences.length === draft.imageReferences.length &&
        admission.mediaBinding.imageReferences.every(
            (reference, index) => reference === draft.imageReferences[index],
        )
    )
}
