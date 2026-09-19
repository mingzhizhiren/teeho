import {
    activeDraftImages,
    areDraftImagesReady,
    isDraftVideoReady,
    type SharedTaskDraft,
} from './taskDraft'

export interface AnalysisMediaRequirement {
    readonly messageKey: 'cover' | 'video' | 'preparing' | null
    readonly coverInvalid: boolean
    readonly videoInvalid: boolean
}

/** 缺少与处理中分开判断，提示、红框和提交阻断使用同一份状态。 */
export function analysisMediaRequirement(draft: SharedTaskDraft): AnalysisMediaRequirement {
    // 与提交载荷一致：未单独指定时，第一张图片就是封面。
    const hasCover = draft.images.length > 0
    const needsVideo = draft.contentKind === 'video'
    const hasVideo = Boolean(draft.video)
    const coverMissing = !needsVideo && !hasCover
    const coverInvalid = coverMissing || !areDraftImagesReady(activeDraftImages(draft))
    const videoInvalid = needsVideo && !isDraftVideoReady(draft.video)
    const messageKey = coverMissing
        ? 'cover'
        : needsVideo && !hasVideo
          ? 'video'
          : coverInvalid || videoInvalid
            ? 'preparing'
            : null
    return { messageKey, coverInvalid, videoInvalid }
}
