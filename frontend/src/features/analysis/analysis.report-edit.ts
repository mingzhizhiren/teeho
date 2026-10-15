import { z } from 'zod'
import { getAnalysisMediaStatuses, getAnalysisVideoStatus } from '@/api/analysis'
import { ApiRequestError } from '@/utils/apiRequestError'
import { HTTP_STATUS } from '@/config/constants'
import type { AnalysisMediaAsset, AnalysisTask } from './analysis.contract'
import { analysisUiConstraints } from './analysis.constants'
import {
    originalImageMetadataForAsset,
    type LocalHistoryImageLoader,
    type LocalHistoryRecord,
} from './localHistory'
import { normalizeTopicList } from './analysis.topic-input'
import {
    createEmptyTaskDraft,
    MISSING_COVER_PREFIX,
    type SharedTaskDraft,
    type SharedTaskImage,
    type SharedTaskVideo,
} from './taskDraft'

/** 报告编辑只读取原任务与同账号历史，不从分析建议生成原稿。 */
export interface ReportEditSource {
    task: AnalysisTask
    historyRecord: LocalHistoryRecord | null
    loadOriginalImage: LocalHistoryImageLoader
}

export interface RestoredReportDraft {
    draft: SharedTaskDraft
    missingImagePositions: number[]
    missingVideo: boolean
}

function isMissingAsset(error: unknown): boolean {
    return (
        error instanceof ApiRequestError &&
        (error.status === HTTP_STATUS.NOT_FOUND || error.status === HTTP_STATUS.GONE)
    )
}

async function loadReusableAssets(ids: string[]): Promise<AnalysisMediaAsset[]> {
    if (!ids.length) return []
    try {
        return await getAnalysisMediaStatuses(ids)
    } catch (error) {
        if (!isMissingAsset(error)) throw error
        // 批量接口不透露哪个身份缺失；逐项核验，只降级真正不存在的素材。
        const assets = await Promise.all(
            ids.map(async (id) => {
                try {
                    return await getAnalysisMediaStatuses([id])
                } catch (itemError) {
                    if (isMissingAsset(itemError)) return []
                    throw itemError
                }
            }),
        )
        return assets.flat()
    }
}

async function restoreVideo(task: AnalysisTask): Promise<SharedTaskVideo | null> {
    const videoId = task.standardTask.videoEvidence?.assetId
    if (task.standardTask.contentKind !== 'video' || !videoId) return null
    try {
        const video = await getAnalysisVideoStatus(videoId)
        if (
            video.state !== 'ready' ||
            !video.evidenceId ||
            !video.declaredMediaType ||
            !video.declaredByteSize ||
            !video.expiresAt ||
            !(Date.parse(video.expiresAt) > Date.now())
        )
            return null
        return {
            localId: video.id,
            file: null,
            fileName: video.fileName,
            byteSize: video.declaredByteSize,
            declaredMediaType: video.declaredMediaType,
            videoId: video.id,
            status: 'ready',
            uploadProgress: analysisUiConstraints.percentageComplete,
            queuePosition: null,
            evidenceId: video.evidenceId,
            errorCode: null,
            remoteUpdatedAt: video.updatedAt,
            origin: 'report',
        }
    } catch (error) {
        if (isMissingAsset(error)) return null
        throw error
    }
}

/** 恢复之前逐项核验服务端资产；本地文件不能绕过保留期。 */
export async function restoreReportDraft(source: ReportEditSource): Promise<RestoredReportDraft> {
    const standard = source.task.standardTask
    const references =
        standard.contentKind === 'video'
            ? standard.coverReference
                ? [standard.coverReference]
                : []
            : standard.imageReferences
    const ids = references.filter((id) => z.uuid().safeParse(id).success)
    const assets = await loadReusableAssets(ids)
    const byId = new Map(assets.map((asset) => [asset.id, asset]))
    const recovered = await Promise.all(
        references.map(async (assetId) => {
            const asset = byId.get(assetId)
            if (
                !asset ||
                asset.state !== 'ready' ||
                !asset.contentHash ||
                !(Date.parse(asset.expiresAt) > Date.now())
            )
                return null
            const metadata = source.historyRecord
                ? originalImageMetadataForAsset(source.historyRecord, assetId)
                : null
            const reusable =
                asset.declaredMediaType && asset.declaredByteSize
                    ? {
                          fileName: asset.fileName,
                          declaredMediaType: asset.declaredMediaType,
                          declaredByteSize: asset.declaredByteSize,
                          expiresAt: asset.expiresAt,
                      }
                    : undefined
            const original = metadata
                ? await source
                      .loadOriginalImage(source.task.id, metadata.id)
                      .catch((error: unknown) => {
                          // 本地原片不可读时仍能使用已核验的远端身份，不能拿预览冒充原片。
                          if (reusable) return null
                          throw error
                      })
                : null
            if (!original && !reusable) return null
            return {
                localId: asset.id,
                file: original
                    ? new File([original.content], original.metadata.name, {
                          type: original.metadata.type,
                          lastModified: original.metadata.lastModified,
                      })
                    : null,
                reusable,
                assetId: asset.id,
                status: 'ready',
                uploadProgress: analysisUiConstraints.percentageComplete,
                contentHash: asset.contentHash,
                errorCode: null,
                failureStage: null,
            } satisfies SharedTaskImage
        }),
    )
    const images = recovered.filter((image): image is NonNullable<typeof image> => image !== null)
    const video = await restoreVideo(source.task)
    const coverReference =
        standard.coverReference ?? (standard.contentKind === 'image' ? references[0] : undefined)
    const coverLocalId =
        images.find((image) => image.assetId === coverReference)?.localId ??
        (standard.contentKind === 'image' && coverReference
            ? `${MISSING_COVER_PREFIX}${coverReference}`
            : null)
    return {
        draft: {
            ...createEmptyTaskDraft(),
            contentKind: standard.contentKind,
            fields: {
                title: standard.fields.title?.value ?? '',
                body: standard.fields.body?.value ?? '',
                topics: normalizeTopicList(standard.fields.topics?.value ?? []),
            },
            images,
            video,
            coverLocalId,
        },
        missingImagePositions: recovered.flatMap((image, index) => (image ? [] : [index + 1])),
        missingVideo: standard.contentKind === 'video' && video === null,
    }
}
