import { describe, expect, it, vi } from 'vitest'

import { runAnalysisMediaCleanup } from '../../../../supabase/functions/_shared/analysis-media-cleanup'

const first = {
    id: '00000000-0000-4000-8000-000000000001',
    originalObjectPath: 'private/first/original.jpg',
    processedObjectPath: 'private/first/processed.jpg',
}
const second = {
    id: '00000000-0000-4000-8000-000000000002',
    originalObjectPath: 'private/second/original.jpg',
    processedObjectPath: null,
}

describe('analysis media cleanup coordinator', () => {
    it('continues after a partial Storage failure and records each terminal outcome', async () => {
        const claim = vi.fn().mockResolvedValueOnce([first, second]).mockResolvedValueOnce([])
        const remove = vi.fn(async (paths: string[]) => {
            if (paths.includes(second.originalObjectPath)) {
                throw new Error('storage unavailable')
            }
        })
        const complete = vi.fn(async () => undefined)

        const summary = await runAnalysisMediaCleanup({ claim, remove, complete })

        expect(summary).toEqual({ claimed: 2, deleted: 1, failed: 1, batches: 1 })
        expect(remove).toHaveBeenNthCalledWith(1, [
            first.originalObjectPath,
            first.processedObjectPath,
        ])
        expect(complete).toHaveBeenCalledWith(first.id, true, null)
        expect(complete).toHaveBeenCalledWith(second.id, false, 'storage_delete_failed')
    })

    it('is a no-op when a repeated invocation has no claimable records', async () => {
        const remove = vi.fn()
        const complete = vi.fn()

        await expect(
            runAnalysisMediaCleanup({
                claim: vi.fn(async () => []),
                remove,
                complete,
            }),
        ).resolves.toEqual({ claimed: 0, deleted: 0, failed: 0, batches: 1 })
        expect(remove).not.toHaveBeenCalled()
        expect(complete).not.toHaveBeenCalled()
    })
})
