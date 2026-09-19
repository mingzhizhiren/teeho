import { describe, expect, test } from 'bun:test'

import {
    createAnalysisRitualAssignmentManager,
    type AnalysisRitualAssignment,
    type AnalysisRitualAssignmentStorage,
} from '@/features/analysis/analysis.ritual-assignment'

const firstTaskId = '11111111-1111-4111-8111-111111111111'
const secondTaskId = '22222222-2222-4222-8222-222222222222'

function createMemoryStorage(initial: AnalysisRitualAssignment | null = null) {
    let value = initial
    const storage: AnalysisRitualAssignmentStorage = {
        get: async () => value,
        set: async (nextValue) => {
            value = nextValue
        },
    }
    return { storage, value: () => value }
}

describe('analysis ritual assignment', () => {
    test('同一任务跨管理器实例保持动画，新任务才重新随机', async () => {
        const memory = createMemoryStorage()
        let firstRandomCalls = 0
        const firstManager = createAnalysisRitualAssignmentManager(memory.storage, () => {
            firstRandomCalls += 1
            return 0.34
        })

        expect(await firstManager.getOrAssign(firstTaskId)).toBe('B')
        expect(memory.value()).toEqual({ taskId: firstTaskId, variant: 'B' })
        expect(firstRandomCalls).toBe(1)

        let restoredRandomCalls = 0
        const restoredManager = createAnalysisRitualAssignmentManager(memory.storage, () => {
            restoredRandomCalls += 1
            return 0.99
        })
        expect(await restoredManager.getOrAssign(firstTaskId)).toBe('B')
        expect(restoredRandomCalls).toBe(0)

        expect(await restoredManager.getOrAssign(secondTaskId)).toBe('C')
        expect(memory.value()).toEqual({ taskId: secondTaskId, variant: 'C' })
        expect(restoredRandomCalls).toBe(1)
    })

    test('本地存储不可用时仍返回本次内存动画', async () => {
        const manager = createAnalysisRitualAssignmentManager(
            {
                get: async () => {
                    throw new Error('storage_unavailable')
                },
                set: async () => {
                    throw new Error('storage_unavailable')
                },
            },
            () => 0,
        )

        expect(await manager.getOrAssign(firstTaskId)).toBe('A')
    })
})
