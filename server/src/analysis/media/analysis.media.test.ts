import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { analysisMediaConstraints } from '../analysis.constants'
import { normalizeImage } from './analysis.image-normalization'
import { processAnalysisImage } from './analysis.media'

describe('processed analysis media', () => {
    it('normalizes a controlled video frame with its own WebP profile', async () => {
        const original = await sharp({
            create: {
                width: 1_600,
                height: 900,
                channels: 3,
                background: '#51409b',
            },
        })
            .jpeg({ quality: 95 })
            .withMetadata({ orientation: 1 })
            .toBuffer()

        const normalized = await normalizeImage(original, {
            inputPixelLimit: 40_000_000,
            maxEdgePixels: 1_024,
            outputFormat: 'webp',
            lossyQuality: 80,
        })
        const metadata = await sharp(normalized.content).metadata()

        expect(normalized).toMatchObject({
            mediaType: 'image/webp',
            width: 1_024,
            height: 576,
        })
        expect(metadata.exif).toBeUndefined()
        expect(metadata.orientation).toBeUndefined()
        expect(metadata.space).toBe('srgb')
    })

    it('uses the agreed lossy quality without exposing it through the UI contract', () => {
        expect(analysisMediaConstraints.lossyQuality).toBe(82)
    })

    it('corrects orientation, strips metadata and limits the longest edge to 2048px', async () => {
        const original = await sharp({
            create: {
                width: 3_000,
                height: 1_500,
                channels: 3,
                background: '#cc3366',
            },
        })
            .jpeg({ quality: 95 })
            .withMetadata({ orientation: 6 })
            .toBuffer()

        const processed = await processAnalysisImage(original, {
            fileName: 'portrait.jpg',
            declaredMediaType: 'image/jpeg',
        })
        const metadata = await sharp(processed.content).metadata()

        expect(processed.mediaType).toBe('image/jpeg')
        expect(Math.max(processed.width, processed.height)).toBe(2_048)
        expect(processed.width).toBeLessThan(processed.height)
        expect(metadata.orientation).toBeUndefined()
        expect(metadata.exif).toBeUndefined()
    })

    it('does not enlarge a small PNG and keeps PNG output lossless', async () => {
        const original = await sharp({
            create: {
                width: 320,
                height: 180,
                channels: 4,
                background: { r: 20, g: 40, b: 60, alpha: 0.5 },
            },
        })
            .png()
            .toBuffer()

        const processed = await processAnalysisImage(original, {
            fileName: 'small.png',
            declaredMediaType: 'image/png',
        })

        expect(processed).toMatchObject({
            mediaType: 'image/png',
            width: 320,
            height: 180,
        })
    })

    it('rejects spoofed or damaged uploads before a derived asset is produced', async () => {
        const jpeg = await sharp({
            create: {
                width: 10,
                height: 10,
                channels: 3,
                background: '#ffffff',
            },
        })
            .jpeg()
            .toBuffer()

        await expect(
            processAnalysisImage(jpeg, {
                fileName: 'fake.png',
                declaredMediaType: 'image/png',
            }),
        ).rejects.toMatchObject({
            code: 'spoofed_image_type',
        })
        await expect(
            processAnalysisImage(new Uint8Array([1, 2, 3]), {
                fileName: 'broken.jpg',
                declaredMediaType: 'image/jpeg',
            }),
        ).rejects.toMatchObject({
            code: 'image_decode_failed',
        })
    })
})
