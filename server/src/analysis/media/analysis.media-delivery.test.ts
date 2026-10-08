import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

import { AnalysisAssetExpiredError } from '../analysis.errors'
import { loadAgentImagesForReferences } from './analysis.media-delivery'
import type { AnalysisMediaAssetRecord } from './analysis.media.repository'

function readyAsset(id: string, content: Uint8Array): AnalysisMediaAssetRecord {
    return {
        id,
        userId: '00000000-0000-4000-8000-000000000001',
        taskId: null,
        position: null,
        uploadSessionId: '00000000-0000-4000-8000-000000000002',
        state: 'ready',
        fileName: 'image.jpg',
        declaredMediaType: 'image/jpeg',
        declaredByteSize: content.byteLength,
        originalObjectPath: 'private/original.jpg',
        processedObjectPath: `private/processed/${id}.jpg`,
        mediaType: 'image/jpeg',
        byteSize: content.byteLength,
        width: 100,
        height: 80,
        sha256: createHash('sha256').update(content).digest('hex'),
        originalSha256: 'a'.repeat(64),
        processingAttemptCount: 1,
        failureCode: null,
        expiresAt: '2099-01-01T00:00:00.000Z',
    }
}

describe('analysis media provider delivery', () => {
    it.each([1, 6, 18])('%i张图片最多四路下载，乱序完成仍按输入顺序返回', async (count) => {
        const content = new Uint8Array([1, 2, 3])
        const records = Array.from({ length: count }, (_, index) =>
            readyAsset(String(index), content),
        )
        const releases: Array<() => void> = []
        let active = 0
        let peak = 0
        const download = vi.fn(async () => {
            active += 1
            peak = Math.max(peak, active)
            await new Promise<void>((resolve) => releases.push(resolve))
            active -= 1
            return content
        })
        const pending = loadAgentImagesForReferences(
            records[0]!.userId,
            records.map((asset) => asset.id),
            { findOwned: async () => records, download },
        )
        try {
            await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(Math.min(count, 4)))
            for (let completed = 0; completed < count; completed += 1) {
                await vi.waitFor(() => expect(releases.length).toBeGreaterThan(0))
                releases.pop()!()
                await Promise.resolve()
            }
            const result = await pending
            expect(peak).toBe(Math.min(count, 4))
            expect(result.map((image) => image.reference)).toEqual(records.map((asset) => asset.id))
        } finally {
            for (const release of releases) release()
        }
    })
    it('完整性失败后停止排入后续图片，并等待已开始的下载收尾', async () => {
        const content = new Uint8Array([1])
        const records = Array.from({ length: 6 }, (_, index) => readyAsset(String(index), content))
        const releases: Array<(value: Uint8Array) => void> = []
        const download = vi.fn(() => new Promise<Uint8Array>((resolve) => releases.push(resolve)))
        let settled = false
        const pending = loadAgentImagesForReferences(
            records[0]!.userId,
            records.map((asset) => asset.id),
            { findOwned: async () => records, download },
        )
        const result = pending.catch((error: unknown) => {
            settled = true
            return error
        })
        await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(4))
        releases[0]!(new Uint8Array([9]))
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(settled).toBe(false)
        for (const release of releases.slice(1)) release(content)
        expect(await result).toBeInstanceOf(AnalysisAssetExpiredError)
        expect(download).toHaveBeenCalledTimes(4)
    })
    it('loads only owned ready derived assets and preserves the shared draft order', async () => {
        const firstId = '00000000-0000-4000-8000-000000000010'
        const secondId = '00000000-0000-4000-8000-000000000011'
        const firstContent = new Uint8Array([1, 2, 3])
        const secondContent = new Uint8Array([4, 5, 6])
        const records = [readyAsset(firstId, firstContent), readyAsset(secondId, secondContent)]
        const download = vi.fn(async (path: string) =>
            path.includes(secondId) ? secondContent : firstContent,
        )

        const images = await loadAgentImagesForReferences(records[0]!.userId, [secondId, firstId], {
            findOwned: vi.fn(async () => records),
            download,
        })

        expect(images.map((image) => image.reference)).toEqual([secondId, firstId])
        expect(images.map((image) => image.sourceSha256)).toEqual([
            records[1]!.originalSha256,
            records[0]!.originalSha256,
        ])
        expect(images[0]?.content).toEqual(secondContent)
        expect(images[0]).not.toHaveProperty('contentBase64')
        expect(JSON.stringify(images)).not.toContain('processedObjectPath')
    })

    it('rejects missing, expired, non-ready, or integrity-mismatched assets', async () => {
        const id = '00000000-0000-4000-8000-000000000010'
        const content = new Uint8Array([1, 2, 3])
        const asset = readyAsset(id, content)

        await expect(
            loadAgentImagesForReferences(asset.userId, [id], {
                findOwned: vi.fn(async () => [{ ...asset, state: 'failed' as const }]),
                download: vi.fn(),
            }),
        ).rejects.toBeInstanceOf(AnalysisAssetExpiredError)
        await expect(
            loadAgentImagesForReferences(asset.userId, [id], {
                findOwned: vi.fn(async () => [asset]),
                download: vi.fn(async () => new Uint8Array([9, 9, 9])),
            }),
        ).rejects.toBeInstanceOf(AnalysisAssetExpiredError)
    })
})
