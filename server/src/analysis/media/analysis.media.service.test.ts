import { describe, expect, it, vi } from 'vitest'

import { AnalysisMediaUploadRateLimitError } from './analysis.media-upload-admission'
import type { AnalysisMediaAssetRecord } from './analysis.media.repository'
import { createAnalysisMediaService } from './analysis.media.service'
import type { AnalysisObjectStorage } from './analysis.storage'

const userId = '00000000-0000-4000-8000-000000000001'

function createHarness() {
    const records = new Map<string, AnalysisMediaAssetRecord>()
    const storage: AnalysisObjectStorage = {
        createSignedUpload: vi.fn(async (path) => ({
            signedUrl: `https://storage.test/${path}?token=signed`,
            token: 'signed',
        })),
        info: vi.fn(async () => ({ size: 1_024, contentType: 'image/jpeg' })),
        download: vi.fn(),
        upload: vi.fn(),
        remove: vi.fn(),
    }
    const persistence = {
        async insertSession(param: {
            sessionId: string
            userId: string
            uploadExpiresAt: string
            assetExpiresAt: string
            assets: Array<{
                id: string
                position: number
                fileName: string
                declaredMediaType: AnalysisMediaAssetRecord['declaredMediaType']
                declaredByteSize: number
                originalObjectPath: string
            }>
        }) {
            for (const asset of param.assets) {
                records.set(asset.id, {
                    id: asset.id,
                    userId: param.userId,
                    taskId: null,
                    position: asset.position,
                    uploadSessionId: param.sessionId,
                    state: 'awaiting_upload',
                    fileName: asset.fileName,
                    declaredMediaType: asset.declaredMediaType,
                    declaredByteSize: asset.declaredByteSize,
                    originalObjectPath: asset.originalObjectPath,
                    processedObjectPath: null,
                    mediaType: null,
                    byteSize: null,
                    width: null,
                    height: null,
                    sha256: null,
                    originalSha256: null,
                    processingAttemptCount: 0,
                    failureCode: null,
                    expiresAt: param.assetExpiresAt,
                })
            }
        },
        async findOwned(currentUserId: string, ids: string[]) {
            return ids.flatMap((id) => {
                const record = records.get(id)
                return record?.userId === currentUserId ? [record] : []
            })
        },
        async markUploaded(assetId: string, currentUserId: string) {
            const record = records.get(assetId)
            if (!record || record.userId !== currentUserId) {
                return null
            }
            record.state = 'uploaded'
            return record
        },
        async retry() {
            return true
        },
        async hasCleanupRequested() {
            return false
        },
    }
    return {
        records,
        persistence,
        storage,
        service: createAnalysisMediaService({
            storage,
            persistence,
            clock: {
                now: () => new Date('2026-08-02T04:00:00.000Z'),
                randomUUID: () => crypto.randomUUID(),
            },
        }),
    }
}

describe('analysis media service', () => {
    it('does not sign uploads after the account window clears draft media', async () => {
        const { service, persistence, storage } = createHarness()
        vi.spyOn(persistence, 'insertSession').mockRejectedValueOnce(
            new AnalysisMediaUploadRateLimitError(),
        )

        await expect(
            service.createUploadSession(userId, [
                { fileName: 'one.jpg', declaredMediaType: 'image/jpeg', byteSize: 1_024 },
            ]),
        ).rejects.toBeInstanceOf(AnalysisMediaUploadRateLimitError)
        expect(storage.createSignedUpload).not.toHaveBeenCalled()
    })

    it('rejects an in-flight confirmation after another page clears draft media', async () => {
        const { service, persistence } = createHarness()
        vi.spyOn(persistence, 'hasCleanupRequested').mockResolvedValueOnce(true)

        await expect(
            service.confirmUpload(userId, '00000000-0000-4000-8000-000000000099'),
        ).rejects.toBeInstanceOf(AnalysisMediaUploadRateLimitError)
    })

    it('issues user-scoped direct upload qualifications without receiving file bytes', async () => {
        const { service, storage } = createHarness()

        const session = await service.createUploadSession(userId, [
            { fileName: 'one.jpg', declaredMediaType: 'image/jpeg', byteSize: 1_024 },
            { fileName: 'two.png', declaredMediaType: 'image/png', byteSize: 2_048 },
        ])

        expect(session.assets).toHaveLength(2)
        expect(session.assets.every((asset) => asset.state === 'awaiting_upload')).toBe(true)
        expect(session.assets[0]?.uploadUrl).toContain('https://storage.test/')
        expect(storage.createSignedUpload).toHaveBeenCalledTimes(2)
        for (const [path] of vi.mocked(storage.createSignedUpload).mock.calls) {
            expect(path).toMatch(new RegExp(`^${userId}/`))
            expect(path).not.toContain('one.jpg')
        }
        expect(JSON.stringify(session)).not.toContain('originalObjectPath')
    })

    it('rejects a single 50 MiB file before signing any upload', async () => {
        const { service, storage } = createHarness()

        await expect(
            service.createUploadSession(userId, [
                {
                    fileName: 'too-large.jpg',
                    declaredMediaType: 'image/jpeg',
                    byteSize: 50 * 1024 * 1024,
                },
            ]),
        ).rejects.toMatchObject({
            code: 'image_too_large',
        })
        expect(storage.createSignedUpload).not.toHaveBeenCalled()
    })

    it('confirms only an owned object that actually exists, then exposes short polling state', async () => {
        const { service, storage } = createHarness()
        const session = await service.createUploadSession(userId, [
            { fileName: 'one.jpg', declaredMediaType: 'image/jpeg', byteSize: 1_024 },
        ])
        const assetId = session.assets[0]!.id

        await expect(service.confirmUpload(userId, assetId)).resolves.toMatchObject({
            id: assetId,
            state: 'uploaded',
        })
        await expect(service.getStatuses(userId, [assetId])).resolves.toEqual([
            expect.objectContaining({ id: assetId, state: 'uploaded' }),
        ])
        await expect(
            service.getStatuses('00000000-0000-4000-8000-000000000099', [assetId]),
        ).rejects.toThrow('图片素材不存在')

        vi.mocked(storage.info).mockResolvedValueOnce(null)
        const second = await service.createUploadSession(userId, [
            { fileName: 'missing.jpg', declaredMediaType: 'image/jpeg', byteSize: 1_024 },
        ])
        await expect(service.confirmUpload(userId, second.assets[0]!.id)).rejects.toThrow(
            '上传对象不存在',
        )
    })
})
