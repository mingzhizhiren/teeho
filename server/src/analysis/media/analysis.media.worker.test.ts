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
    it.each([1, 6, 18])('%i张图片有界处理，坏图不阻断剩余素材', async (count) => {
        const original = await sharp({
            create: { width: 64, height: 64, channels: 3, background: '#112233' },
        })
            .jpeg()
            .toBuffer()
        let next = 0
        let active = 0
        let peak = 0
        const claimNext = vi.fn(async () =>
            next < count
                ? {
                      ...record(),
                      id: String(++next),
                      declaredByteSize: original.byteLength,
                      originalObjectPath: `original/${next}`,
                  }
                : null,
        )
        const worker = new AnalysisMediaWorker({
            claimNext,
            storage: {
                createSignedUpload: vi.fn(),
                info: vi.fn(),
                remove: vi.fn(),
                download: async (key) => {
                    active += 1
                    peak = Math.max(peak, active)
                    await new Promise((resolve) => setTimeout(resolve, 5))
                    return key === 'original/1' ? new Uint8Array([0]) : new Uint8Array(original)
                },
                upload: vi.fn(async () => undefined),
            },
            markReady: vi.fn(async () => {
                active -= 1
                return true
            }),
            markFailed: vi.fn(async () => {
                active -= 1
            }),
            log: { info: vi.fn(), warn: vi.fn() },
        })
        worker.start()
        try {
            await vi.waitFor(() => {
                expect(next).toBe(count)
                expect(active).toBe(0)
            })
            expect(peak).toBe(Math.min(count, 3))
        } finally {
            await worker.stop()
        }
    })
    it('同时处理三张，空闲槽立即补位，停止时等待在途图片完成且不再领取', async () => {
        const original = await sharp({
            create: { width: 20, height: 20, channels: 3, background: '#112233' },
        })
            .jpeg()
            .toBuffer()
        let next = 0
        const claimNext = vi.fn(async () => ({
            ...record(),
            id: String(++next),
            declaredByteSize: original.byteLength,
            originalObjectPath: `original/${next}`,
        }))
        const releases = new Map<string, () => void>()
        const storage: AnalysisObjectStorage = {
            createSignedUpload: vi.fn(),
            info: vi.fn(),
            remove: vi.fn(),
            download: vi.fn(
                (key) =>
                    new Promise<Uint8Array>((resolve) => {
                        releases.set(key, () => resolve(new Uint8Array(original)))
                    }),
            ),
            upload: vi.fn(async () => undefined),
        }
        const markReady = vi.fn(async () => true)
        const worker = new AnalysisMediaWorker({
            storage,
            claimNext,
            markReady,
            markFailed: vi.fn(),
            pollIntervalMs: 10,
        })
        worker.start()
        try {
            await vi.waitFor(() => expect(storage.download).toHaveBeenCalledTimes(3))
            worker.wake()
            expect(claimNext).toHaveBeenCalledTimes(3)
            releases.get('original/2')!()
            await vi.waitFor(() => expect(storage.download).toHaveBeenCalledTimes(4))
            let stopped = false
            const stopping = Promise.resolve(worker.stop()).then(() => {
                stopped = true
            })
            await Promise.resolve()
            expect(stopped).toBe(false)
            expect(worker.readReadiness()).toEqual({ started: false, busy: true })
            for (const release of releases.values()) release()
            await stopping
            expect(claimNext).toHaveBeenCalledTimes(4)
            expect(markReady).toHaveBeenCalledTimes(4)
            expect(worker.readReadiness()).toEqual({ started: false, busy: false })
        } finally {
            const stopping = worker.stop()
            for (const release of releases.values()) release()
            await stopping
        }
    })
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
        await worker.stop()
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
