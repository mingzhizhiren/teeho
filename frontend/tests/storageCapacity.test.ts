import { describe, expect, test } from 'bun:test'

import {
    estimateLocalHistoryBytes,
    evaluateStorageCapacity,
    resolveStorageSubmission,
} from '@/features/analysis/storageCapacity'

const draft = {
    inputMode: 'agent' as const,
    rawText: '通勤防晒内容',
    imageReferences: [],
    fields: {
        topic: '通勤防晒',
    },
}

describe('本地历史容量决策', () => {
    test('容量充足时按正常流程提交并保存历史', () => {
        const requiredBytes = estimateLocalHistoryBytes({
            draft,
            images: [
                new File([new Uint8Array(2 * 1024 * 1024)], 'source.webp', {
                    type: 'image/webp',
                }),
            ],
        })
        const capacity = evaluateStorageCapacity(requiredBytes, {
            usage: 5 * 1024 * 1024,
            quota: 30 * 1024 * 1024,
        })

        expect(capacity.status).toBe('sufficient')
        expect(resolveStorageSubmission(capacity)).toEqual({
            action: 'submit',
            persistHistory: true,
        })
    })

    test('容量不足选择清理历史时不提交，也不自动删除任何旧任务', () => {
        const capacity = evaluateStorageCapacity(8 * 1024 * 1024, {
            usage: 9 * 1024 * 1024,
            quota: 10 * 1024 * 1024,
        })

        expect(resolveStorageSubmission(capacity)).toEqual({ action: 'await_choice' })
        expect(resolveStorageSubmission(capacity, 'manage_history')).toEqual({
            action: 'manage_history',
        })
    })

    test('容量不足选择本次不保存时允许提交，但明确只保留在当前页面', () => {
        const capacity = evaluateStorageCapacity(8 * 1024 * 1024, {
            usage: 9 * 1024 * 1024,
            quota: 10 * 1024 * 1024,
        })

        expect(resolveStorageSubmission(capacity, 'session_only')).toEqual({
            action: 'submit',
            persistHistory: false,
        })
    })

    test('取消容量选择时不提交且无需修改草稿', () => {
        const capacity = evaluateStorageCapacity(8 * 1024 * 1024, {
            usage: 9 * 1024 * 1024,
            quota: 10 * 1024 * 1024,
        })

        expect(resolveStorageSubmission(capacity, 'cancel')).toEqual({ action: 'cancel' })
    })

    test('估算包含原图、任务快照、预期结果和加密存储开销', () => {
        const imageBytes = 1024 * 1024
        const requiredBytes = estimateLocalHistoryBytes({
            draft,
            images: [
                new File([new Uint8Array(imageBytes)], 'source.png', {
                    type: 'image/png',
                }),
            ],
        })

        expect(requiredBytes).toBeGreaterThan(imageBytes)
    })
})
