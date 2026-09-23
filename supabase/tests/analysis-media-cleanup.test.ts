import { describe, expect, test } from 'bun:test'
import {
    parseCleanupCandidates,
    runAnalysisMediaCleanup,
} from '../functions/_shared/analysis-media-cleanup'

const assetId = '00000000-0000-4000-8000-000000000001'

describe('媒体清理', () => {
    test('校验 RPC 输出和对象路径，拒绝越界路径与缺失字段', () => {
        expect(
            parseCleanupCandidates([
                {
                    id: assetId,
                    original_object_path: 'synthetic/original.png',
                    processed_object_path: null,
                },
            ]),
        ).toEqual([
            {
                id: assetId,
                originalObjectPath: 'synthetic/original.png',
                processedObjectPath: null,
            },
        ])
        for (const invalid of [
            null,
            {},
            [{}],
            [{ id: assetId, original_object_path: '../outside', processed_object_path: null }],
        ]) {
            expect(() => parseCleanupCandidates(invalid)).toThrow('cleanup_invalid_response')
        }
    })

    test('Storage 删除失败仅登记失败，不把未删对象标为 deleted', async () => {
        const completions: unknown[][] = []
        const summary = await runAnalysisMediaCleanup({
            claim: async () => [
                {
                    id: assetId,
                    originalObjectPath: 'synthetic/original.png',
                    processedObjectPath: null,
                },
            ],
            remove: async () => {
                throw new Error('synthetic_storage_failure')
            },
            complete: async (...args) => {
                completions.push(args)
            },
        })
        expect(summary).toEqual({ claimed: 1, deleted: 0, failed: 1, batches: 1 })
        expect(completions).toEqual([[assetId, false, 'storage_delete_failed']])
    })
})
