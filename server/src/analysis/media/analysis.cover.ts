import type { StandardAnalysisTask } from '../analysis.schema'
import type { AgentImageAsset, AgentVideoEvidence } from '../providers/analysis.provider'

/** 独立封面优先；视频未指定封面时使用已经抽取的零时刻首帧。 */
export function resolveAnalysisCover(
    task: Pick<StandardAnalysisTask, 'contentKind' | 'coverReference'>,
    images: readonly AgentImageAsset[],
    videoEvidence: AgentVideoEvidence | null,
): AgentImageAsset | undefined {
    const reference =
        task.coverReference ??
        (task.contentKind === 'video'
            ? videoEvidence?.frames.find((frame) => frame.timestampMs === 0)?.reference
            : undefined)
    if (!reference) return undefined
    return images.find((image) =>
        (image.originalReferences ?? [image.reference]).includes(reference),
    )
}
