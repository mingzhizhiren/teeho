import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'

import type { AnalysisMediaAssetRecord } from './analysis.media.repository'
import { AnalysisMediaWorker } from './analysis.media.worker'
import type { AnalysisObjectStorage } from './analysis.storage'

function record(): AnalysisMediaAssetRecord {
    return {
        id: '00000000-0000-4000-8000-000000000001',
        userId: '00000000-0000-4000-8000-000000000002',
        taskId: null,
        position: 0,
        uploadSessionId: '00000000-0000-4000-8000-000000000003',
        state: 'processing',
        fileName: 'large.jpg',
        declaredMediaType: 'image/jpeg',
        declaredByteSize: 1_024,
        originalObjectPath: '00000000-0000-4000-8000-000000000002/session/original/asset.jpg',
        processedObjectPath: null,
        mediaType: null,
        byteSize: null,
        width: null,
        height: null,
        sha256: null,
        originalSha256: null,
        processingAttemptCount: 1,
        failureCode: null,
        expiresAt: '2026-08-03T00:00:00.000Z',
    }
}

describe('analysis media worker', () => {
    it('downloads the private original and stores only a processed derived image', async () => {
        const original = await sharp({
            create: {
                width: 3_000,
                height: 1_000,
                channels: 3,
                background: '#112233',
            },
        })
            .jpeg()
            .toBuffer()
        const storage: AnalysisObjectStorage = {
            createSignedUpload: vi.fn(),
            info: vi.fn(),
            download: vi.fn(async () => new Uint8Array(original)),
            upload: vi.fn(async () => undefined),
            remove: vi.fn(),
        }
        const markReady = vi.fn(async () => true)
        const markFailed = vi.fn(async () => undefined)
        const log = { info: vi.fn(), warn: vi.fn() }
        const asset = record()
        asset.declaredByteSize = original.byteLength
        const worker = new AnalysisMediaWorker({
            storage,
            claimNext: vi.fn(async () => asset),
            markReady,
            markFailed,
            log,
        })

        await expect(worker.runOnce()).resolves.toBe(true)

        expect(storage.download).toHaveBeenCalledWith(asset.originalObjectPath)
        expect(storage.upload).toHaveBeenCalledWith(
            expect.stringContaining('/processed/'),
            expect.any(Uint8Array),
            'image/jpeg',
        )
        const processed = vi.mocked(storage.upload).mock.calls[0]![1]
        const metadata = await sharp(processed).metadata()
        expect(Math.max(metadata.width!, metadata.height!)).toBe(2_048)
        expect(markReady).toHaveBeenCalledWith(
            asset.id,
            expect.stringContaining('/processed/'),
            expect.objectContaining({ width: 2_048, height: 683 }),
        )
        expect(markFailed).not.toHaveBeenCalled()
        expect(log.info).toHaveBeenCalledWith(
            expect.objectContaining({
                event: 'analysis_media_processed',
                assetId: asset.id,
                attemptNumber: 1,
                width: 2_048,
                height: 683,
                durationMs: expect.any(Number),
            }),
            '分析图片处理完成',
        )
    })

    it('records a stable failure code when decoding fails', async () => {
        const markFailed = vi.fn(async () => undefined)
        const worker = new AnalysisMediaWorker({
            storage: {
                createSignedUpload: vi.fn(),
                info: vi.fn(),
                download: vi.fn(async () => new Uint8Array([1, 2, 3])),
                upload: vi.fn(),
                remove: vi.fn(),
            },
            claimNext: vi.fn(async () => record()),
            markReady: vi.fn(),
            markFailed,
        })

        await expect(worker.runOnce()).resolves.toBe(true)
        expect(markFailed).toHaveBeenCalledWith(record().id, 'image_decode_failed')
    })

    it('超限清理在处理中发生时删除刚生成的派生对象', async () => {
        const original = await sharp({
            create: {
                width: 20,
                height: 20,
                channels: 3,
                background: '#112233',
            },
        })
            .jpeg()
            .toBuffer()
        const storage: AnalysisObjectStorage = {
            createSignedUpload: vi.fn(),
            info: vi.fn(),
            download: vi.fn(async () => new Uint8Array(original)),
            upload: vi.fn(async () => undefined),
            remove: vi.fn(async () => undefined),
        }
        const asset = { ...record(), declaredByteSize: original.byteLength }
        const worker = new AnalysisMediaWorker({
            storage,
            claimNext: vi.fn(async () => asset),
            markReady: vi.fn(async () => false),
            markFailed: vi.fn(async () => undefined),
        })

        await expect(worker.runOnce()).resolves.toBe(true)

        expect(storage.remove).toHaveBeenCalledWith([expect.stringContaining('/processed/')])
    })

    it('does not leak an unhandled rejection when failure-state persistence is transiently unavailable', async () => {
        const log = { info: vi.fn(), warn: vi.fn() }
        const worker = new AnalysisMediaWorker({
            storage: {
                createSignedUpload: vi.fn(),
                info: vi.fn(),
                download: vi.fn(async () => new Uint8Array([1, 2, 3])),
                upload: vi.fn(),
                remove: vi.fn(),
            },
            claimNext: vi.fn(async () => record()),
            markReady: vi.fn(),
            markFailed: vi.fn(async () => {
                throw new Error('temporary database failure')
            }),
            log,
        })

        await expect(worker.runOnce()).resolves.toBe(true)
        expect(log.warn).toHaveBeenCalledWith(
            expect.objectContaining({
                errorCode: 'analysis_media_failure_state_write_failed',
            }),
            expect.any(String),
        )
    })

    it('keeps polling after a transient database claim failure', async () => {
        const claimNext = vi
            .fn<() => Promise<AnalysisMediaAssetRecord | null>>()
            .mockRejectedValueOnce(new Error('temporary database failure'))
            .mockResolvedValue(null)
        const log = { info: vi.fn(), warn: vi.fn() }
        const worker = new AnalysisMediaWorker({
            claimNext,
            pollIntervalMs: 1,
            log,
        })

        worker.start()
        expect(worker.readReadiness().started).toBe(true)
        await vi.waitFor(() => expect(claimNext.mock.calls.length).toBeGreaterThanOrEqual(2))
        worker.stop()
        expect(worker.readReadiness()).toEqual({ started: false, busy: false })

        expect(log.warn).toHaveBeenCalledWith(
            expect.objectContaining({
                event: 'analysis_media_claim_failed',
                errorCode: 'analysis_media_claim_failed',
                err: expect.any(Error),
            }),
            expect.any(String),
        )
        expect(log.info).toHaveBeenCalledWith(
            { event: 'analysis_media_claim_recovered' },
            '分析图片队列领取已恢复',
        )
    })
})
