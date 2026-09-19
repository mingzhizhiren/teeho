import type { StandardAnalysisTask } from './analysis.contract'

/** 原图顺序与提交引用一致；明确指定的封面不能被其他可用图片替代。 */
export function resultCoverIndex(
    task: Pick<StandardAnalysisTask, 'contentKind' | 'coverReference' | 'imageReferences'>,
): number {
    if (task.contentKind === 'video' || !task.coverReference) return 0
    return task.imageReferences.indexOf(task.coverReference)
}
