import { z } from 'zod'
import { analysisExecutionConstraints } from '../analysis.constants'
import { analysisDraftSchema, type AnalysisDraft } from '../analysis.schema'
import {
    analysisTaskAdmissionMatchesDraft,
    analysisTaskAdmissionSchema,
    type AnalysisTaskAdmission,
} from '../tasks/analysis.task-admission'

interface ParsedAnalysisRequest {
    draft: AnalysisDraft
    admission?: AnalysisTaskAdmission
    preparationId?: string
    submissionId?: string
}

/** 把草稿校验错误转换为用户可读消息 */
function draftValidationMessage(error: z.ZodError) {
    return error.issues[0]?.message ?? '任务内容无效'
}

/** 判断未知值是否为普通记录对象 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 预览与提交只接受 JSON 草稿和已就绪素材标识。 */
export function parseAnalysisRequest(
    body: unknown,
): { success: true; data: ParsedAnalysisRequest } | { success: false; message: string } {
    const rawDraft = body
    if (!isRecord(rawDraft)) {
        return { success: false, message: '任务内容无效' }
    }
    const parsedPreparationId = z
        .string()
        .trim()
        .min(1)
        .max(analysisExecutionConstraints.preparationArtifactMaxLength)
        .optional()
        .safeParse(rawDraft.preparationId)
    if (!parsedPreparationId.success) {
        return { success: false, message: '预览凭据无效' }
    }
    const parsedSubmissionId = z.string().uuid().optional().safeParse(rawDraft.submissionId)
    if (!parsedSubmissionId.success) {
        return { success: false, message: '提交标识无效' }
    }
    const parsedAdmission = analysisTaskAdmissionSchema.optional().safeParse(rawDraft.admission)
    if (!parsedAdmission.success) {
        return { success: false, message: '任务受理凭据无效' }
    }
    const {
        admission: omittedAdmission,
        preparationId: omittedPreparationId,
        submissionId: omittedSubmissionId,
        ...draftPayload
    } = rawDraft
    void omittedAdmission
    void omittedPreparationId
    void omittedSubmissionId
    const parsed = analysisDraftSchema.safeParse(draftPayload)
    if (!parsed.success) {
        return { success: false, message: draftValidationMessage(parsed.error) }
    }
    if (
        parsedAdmission.data &&
        !analysisTaskAdmissionMatchesDraft(parsedAdmission.data, parsed.data)
    ) {
        return { success: false, message: '任务素材绑定已失效' }
    }
    return {
        success: true,
        data: {
            draft: parsed.data,
            admission: parsedAdmission.data,
            preparationId: parsedPreparationId.data,
            submissionId: parsedSubmissionId.data,
        },
    }
}
