import { describe, expect, it } from 'vitest'

import { decideAnalysisMediaUploadAdmission } from './analysis.media-upload-admission'

describe('analysis media upload admission', () => {
    it('allows the first hundred images and rejects the hundred-and-first', () => {
        expect(
            decideAnalysisMediaUploadAdmission(
                { imageCount: 99, videoCount: 10 },
                { kind: 'image', count: 1 },
            ),
        ).toEqual({ admitted: true })
        expect(
            decideAnalysisMediaUploadAdmission(
                { imageCount: 100, videoCount: 0 },
                { kind: 'image', count: 1 },
            ),
        ).toEqual({ admitted: false, reason: 'image_limit' })
    })

    it('allows the first ten videos and rejects the eleventh', () => {
        expect(
            decideAnalysisMediaUploadAdmission(
                { imageCount: 100, videoCount: 9 },
                { kind: 'video', count: 1 },
            ),
        ).toEqual({ admitted: true })
        expect(
            decideAnalysisMediaUploadAdmission(
                { imageCount: 0, videoCount: 10 },
                { kind: 'video', count: 1 },
            ),
        ).toEqual({ admitted: false, reason: 'video_limit' })
    })
})
