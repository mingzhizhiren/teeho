import { createHash } from 'node:crypto'

import { getAgentPolicy } from '../../runtime/agent-policy'
import { analysisMediaConstraints, analysisUploadConstraints } from '../analysis.constants'
import { normalizeImage, type NormalizedImageFormat } from '../media/analysis.image-normalization'
import type { AgentImageAsset } from './analysis.provider'

function imageFormat(mediaType: AgentImageAsset['mediaType']): NormalizedImageFormat {
    if (mediaType === 'image/jpeg') return 'jpeg'
    if (mediaType === 'image/png') return 'png'
    return 'webp'
}

function exactSourceHash(image: AgentImageAsset): string {
    return image.sourceSha256 ?? createHash('sha256').update(image.content).digest('hex')
}

function uniqueImages(images: readonly AgentImageAsset[]): AgentImageAsset[] {
    const identified = images.map((image) => ({ image, hash: exactSourceHash(image) }))
    const hashes = new Set<string>()
    return identified.flatMap(({ image, hash }) => {
        if (hashes.has(hash)) return []
        hashes.add(hash)
        const originalReferences = identified
            .filter((candidate) => candidate.hash === hash)
            .flatMap(
                (candidate) => candidate.image.originalReferences ?? [candidate.image.reference],
            )
        return [
            { ...image, sourceSha256: hash, originalReferences: [...new Set(originalReferences)] },
        ]
    })
}

async function resizeForTier(
    image: AgentImageAsset,
    maximumEdge: number,
): Promise<AgentImageAsset> {
    if (Math.max(image.width, image.height) <= maximumEdge) {
        return { ...image }
    }
    const normalized = await normalizeImage(image.content, {
        inputPixelLimit: analysisUploadConstraints.maxPixels,
        maxEdgePixels: maximumEdge,
        outputFormat: imageFormat(image.mediaType),
        lossyQuality: analysisMediaConstraints.lossyQuality,
    })
    return {
        ...image,
        ...normalized,
    }
}

/**
 * 在 Provider 调用前按部署资源策略缩放并仅移除原文件 SHA-256 完全相同的图片。
 * 不修改冻结任务、用户历史或输入数组，也不对近似图片执行视觉筛选。
 */
export async function prepareTaskImagesForProvider(
    images: readonly AgentImageAsset[],
    tier?: string,
): Promise<AgentImageAsset[]> {
    const maximumEdge = getAgentPolicy().imageMaximumEdge(tier)
    return Promise.all(uniqueImages(images).map((image) => resizeForTier(image, maximumEdge)))
}
