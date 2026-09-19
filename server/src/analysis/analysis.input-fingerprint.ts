import { createHash } from 'node:crypto'

import type { AnalysisDraft, StandardAnalysisTask, TaskFieldValue } from './analysis.schema'
import type { AgentImageAsset } from './providers/analysis.provider'

function normalizeFingerprintFieldValue(value: TaskFieldValue | undefined) {
    if (typeof value === 'string') return value.trim()
    if (Array.isArray(value)) return value.map((item) => item.trim())
    return value
}

/** 只描述任务形成语义和素材形态；同形态替换素材不会改变该身份。 */
export function createSemanticDraftFingerprint(draft: AnalysisDraft) {
    const fields = Object.fromEntries(
        Object.entries(draft.fields)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name, value]) => [name, normalizeFingerprintFieldValue(value)]),
    )
    const contentKind = draft.videoReference
        ? 'video'
        : draft.imageReferences.length > 0
          ? 'image'
          : 'text'
    return createHash('sha256')
        .update(
            JSON.stringify({
                rawText: draft.rawText.trim(),
                fields,
                contentKind,
            }),
        )
        .digest('hex')
}

/** 创建后端基于已校验素材内容的有效输入指纹。 */
export function createEffectiveInputFingerprint(
    draft: AnalysisDraft,
    images: AgentImageAsset[],
    videoOriginalSha256?: string,
) {
    return createEffectiveInputFingerprintFromDigests(
        draft,
        images.map((image) => createHash('sha256').update(image.content).digest('hex')),
        videoOriginalSha256,
    )
}

/** 使用有序内容摘要计算同一有效输入身份，无需下载素材正文。 */
export function createEffectiveInputFingerprintFromDigests(
    draft: AnalysisDraft,
    imageDigests: string[],
    videoOriginalSha256?: string,
) {
    const fields = Object.fromEntries(
        Object.entries(draft.fields)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name, value]) => [name, normalizeFingerprintFieldValue(value)]),
    )
    const fingerprintInput = {
        rawText: draft.rawText.trim(),
        fields,
        images: imageDigests,
        coverReference: draft.coverReference ?? draft.imageReferences[0] ?? null,
        ...(videoOriginalSha256 ? { video: videoOriginalSha256 } : {}),
    }
    return createHash('sha256').update(JSON.stringify(fingerprintInput)).digest('hex')
}

/** 从已确认的输入准备身份派生正式提交身份。 */
export function createSubmissionInputFingerprint(preparationFingerprint: string): string {
    return createHash('sha256')
        .update(
            JSON.stringify({
                preparationFingerprint,
            }),
        )
        .digest('hex')
}

/** 视频提交只由原视频内容、封面引用和已确认字段决定。 */
export function createVideoEffectiveInputFingerprint(task: StandardAnalysisTask) {
    if (task.contentKind !== 'video' || !task.videoEvidence) {
        throw new Error('只有视频标准任务可以计算视频输入指纹')
    }
    const fields = Object.fromEntries(
        Object.entries(task.fields)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name, field]) => [name, normalizeFingerprintFieldValue(field.value)]),
    )
    return createHash('sha256')
        .update(
            JSON.stringify({
                originalSha256: task.videoEvidence.originalSha256,
                coverReference: task.coverReference ?? null,
                fields,
            }),
        )
        .digest('hex')
}
