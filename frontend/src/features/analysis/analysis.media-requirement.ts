import {
    activeDraftImages,
    draftCoverImage,
    areDraftImagesUploaded,
    isDraftVideoUploaded,
    type SharedTaskDraft,
} from './taskDraft'

export interface AnalysisMediaRequirement {
    readonly messageKey: 'cover' | 'video' | 'preparing' | null
    readonly coverInvalid: boolean
    readonly videoInvalid: boolean
}

/** 缺少与上传未确认分开判断；预处理交给已受理任务等待。 */
export function analysisMediaRequirement(draft: SharedTaskDraft): AnalysisMediaRequirement {
    // 与提交载荷一致：未单独指定时，第一张图片就是封面。
    const hasCover = Boolean(draftCoverImage(draft))
    const needsVideo = draft.contentKind === 'video'
    const hasVideo = Boolean(draft.video)
    const coverMissing = !needsVideo && !hasCover
    const coverInvalid = coverMissing || !areDraftImagesUploaded(activeDraftImages(draft))
    const videoInvalid = needsVideo && !isDraftVideoUploaded(draft.video)
    const messageKey = coverMissing
        ? 'cover'
        : needsVideo && !hasVideo
          ? 'video'
          : coverInvalid || videoInvalid
            ? 'preparing'
            : null
    return { messageKey, coverInvalid, videoInvalid }
}
