import {
    extractExtendedStructureFeatures,
    EXTENDED_STRUCTURE_KEYS,
    type ExtendedStructureFeatures,
} from './longest'

export const MEDIA_STRUCTURE_KEYS = [
    ...EXTENDED_STRUCTURE_KEYS,
    'imageCount',
    'videoDurationSeconds',
] as const
export interface MediaStructureInput {
    readonly contentType: 'image' | 'video' | 'unknown'
    readonly imageCount?: number | null
    readonly videoDurationSeconds?: number | null
}
export interface MediaStructureFeatures extends ExtendedStructureFeatures {
    readonly imageCount: number | null
    readonly videoDurationSeconds: number | null
}

/** 媒体结构来自事实，未知与不适用保留null；旧模型显式调用原八项提取器。 */
export function extractMediaStructureFeatures(
    title: string,
    body: string,
    topics: readonly string[],
    media: MediaStructureInput,
): MediaStructureFeatures {
    const imageCount = media.contentType === 'image' ? (media.imageCount ?? null) : null
    if (imageCount !== null && (!Number.isSafeInteger(imageCount) || imageCount < 0))
        throw new Error('invalid_image_count')
    const videoDurationSeconds =
        media.contentType === 'video' ? (media.videoDurationSeconds ?? null) : null
    if (
        videoDurationSeconds !== null &&
        (!Number.isFinite(videoDurationSeconds) || videoDurationSeconds < 0)
    )
        throw new Error('invalid_video_duration')
    return {
        ...extractExtendedStructureFeatures(title, body, topics),
        imageCount,
        videoDurationSeconds,
    }
}
