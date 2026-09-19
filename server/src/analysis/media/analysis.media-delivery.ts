import { createHash } from 'node:crypto'
import { logger } from '../../utils/logger'

import { AnalysisAssetExpiredError } from '../analysis.errors'
import type { AgentImageAsset } from '../providers/analysis.provider'
import type { AnalysisMediaAssetRecord } from './analysis.media.repository'

interface AnalysisMediaDeliveryDependencies {
    findOwned: (userId: string, ids: string[]) => Promise<AnalysisMediaAssetRecord[]>
    download: (path: string) => Promise<Uint8Array>
}

type FindOwnedMediaAssets = AnalysisMediaDeliveryDependencies['findOwned']

async function productionDependencies(): Promise<AnalysisMediaDeliveryDependencies> {
    const [{ findOwnedMediaAssets }, { supabaseAnalysisObjectStorage }] = await Promise.all([
        import('./analysis.media.repository'),
        import('./analysis.storage'),
    ])
    return {
        findOwned: findOwnedMediaAssets,
        download: (path) => supabaseAnalysisObjectStorage.download(path),
    }
}

function assertReadyAsset(asset: AnalysisMediaAssetRecord | undefined) {
    if (
        !asset ||
        asset.state !== 'ready' ||
        Date.parse(asset.expiresAt) <= Date.now() ||
        !asset.processedObjectPath ||
        !asset.mediaType ||
        asset.byteSize === null ||
        asset.width === null ||
        asset.height === null ||
        !asset.sha256
    ) {
        throw new AnalysisAssetExpiredError('图片尚未处理完成或已超过临时保存时间')
    }
    return asset as AnalysisMediaAssetRecord & {
        processedObjectPath: string
        mediaType: NonNullable<AnalysisMediaAssetRecord['mediaType']>
        byteSize: number
        width: number
        height: number
        sha256: string
    }
}

/**
 * 任务形成阶段只读取派生图的内容摘要，不下载、更不把图片内容交给 Agent。
 * 返回顺序严格跟随草稿引用顺序，供正式提交凭据复算同一输入指纹。
 */
export async function loadReadyImageDigestsForReferences(
    userId: string,
    references: string[],
    findOwned?: FindOwnedMediaAssets,
) {
    if (references.length === 0) return []
    const repositoryFindOwned =
        findOwned ?? (await import('./analysis.media.repository')).findOwnedMediaAssets
    const records = await repositoryFindOwned(userId, references)
    const byId = new Map(records.map((asset) => [asset.id, asset]))
    return references.map((reference) => {
        const asset = assertReadyAsset(byId.get(reference))
        return asset.sha256
    })
}

/** 加载共享草稿引用的派生图；对象键和签名细节不会越过该边界。 */
export async function loadAgentImagesForReferences(
    userId: string,
    references: string[],
    dependencies?: AnalysisMediaDeliveryDependencies,
): Promise<AgentImageAsset[]> {
    if (references.length === 0) {
        return []
    }
    const adapter = dependencies ?? (await productionDependencies())
    const records = await adapter.findOwned(userId, references)
    const byId = new Map(records.map((asset) => [asset.id, asset]))
    const images: AgentImageAsset[] = []
    for (const reference of references) {
        const asset = assertReadyAsset(byId.get(reference))
        logger.debug(
            {
                event: 'analysis_media_download_reference',
                assetId: reference,
                objectKeyHash: createHash('sha256').update(asset.processedObjectPath).digest('hex'),
                assetState: asset.state,
                expiresAt: asset.expiresAt,
                boundTaskId: asset.taskId,
                expectedByteSize: asset.byteSize,
            },
            '核对待下载图片引用',
        )
        const content = await adapter.download(asset.processedObjectPath)
        const digest = createHash('sha256').update(content).digest('hex')
        if (content.byteLength !== asset.byteSize || digest !== asset.sha256) {
            throw new AnalysisAssetExpiredError('图片完整性校验失败，请重新上传')
        }
        images.push({
            reference,
            mediaType: asset.mediaType,
            byteSize: asset.byteSize,
            width: asset.width,
            height: asset.height,
            content,
            sourceSha256: asset.originalSha256 ?? asset.sha256,
            availability: 'processed_private',
        })
    }
    return images
}

/** Worker 根据不可变任务快照读取已绑定的有序派生图。 */
export async function loadAgentImagesForTask(userId: string, references: string[]) {
    const [{ findReadyMediaAssetsForReferences }, { supabaseAnalysisObjectStorage }] =
        await Promise.all([import('./analysis.media.repository'), import('./analysis.storage')])
    const records = await findReadyMediaAssetsForReferences(userId, references)
    return loadAgentImagesForReferences(userId, references, {
        findOwned: async () => records,
        download: (path) => supabaseAnalysisObjectStorage.download(path),
    })
}
