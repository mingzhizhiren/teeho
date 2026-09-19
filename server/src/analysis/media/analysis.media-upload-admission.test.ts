import { describe, expect, it } from 'vitest'

import { decideAnalysisMediaUploadAdmission } from './analysis.media-upload-admission'

describe('analysis media upload admission', () => {
    it('allows the first fifty images and rejects the fifty-first', () => {
        expect(
            decideAnalysisMediaUploadAdmission(
                { imageCount: 49, videoCount: 5 },
                { kind: 'image', count: 1 },
            ),
        ).toEqual({ admitted: true })
        expect(
            decideAnalysisMediaUploadAdmission(
                { imageCount: 50, videoCount: 0 },
                { kind: 'image', count: 1 },
            ),
        ).toEqual({ admitted: false, reason: 'image_limit' })
    })

    it('allows the first five videos and rejects the sixth', () => {
        expect(
            decideAnalysisMediaUploadAdmission(
                { imageCount: 50, videoCount: 4 },
                { kind: 'video', count: 1 },
            ),
        ).toEqual({ admitted: true })
        expect(
            decideAnalysisMediaUploadAdmission(
                { imageCount: 0, videoCount: 5 },
                { kind: 'video', count: 1 },
            ),
        ).toEqual({ admitted: false, reason: 'video_limit' })
    })
})
