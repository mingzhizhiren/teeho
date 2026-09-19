import { z } from 'zod'

import {
    ANALYSIS_RITUAL_VARIANTS,
    selectAnalysisRitualVariant,
    type AnalysisRitualVariant,
} from './analysis.ritual'

export const ANALYSIS_RITUAL_ASSIGNMENT_STORAGE_KEY = 'analysis.ritual-assignment.v1'

export const analysisRitualAssignmentSchema = z.object({
    taskId: z.string().uuid(),
    variant: z.enum(ANALYSIS_RITUAL_VARIANTS),
})

export type AnalysisRitualAssignment = z.infer<typeof analysisRitualAssignmentSchema>

export interface AnalysisRitualAssignmentStorage {
    get: () => Promise<AnalysisRitualAssignment | null>
    set: (assignment: AnalysisRitualAssignment) => Promise<void>
}

export interface AnalysisRitualAssignmentManager {
    getOrAssign: (taskId: string) => Promise<AnalysisRitualVariant>
}

/** 为当前账号串行读取或创建唯一的活动任务动画绑定。 */
export function createAnalysisRitualAssignmentManager(
    storage: AnalysisRitualAssignmentStorage,
    random: () => number = Math.random,
): AnalysisRitualAssignmentManager {
    let operationQueue: Promise<void> = Promise.resolve()

    async function getOrCreate(taskId: string) {
        let storedAssignment: AnalysisRitualAssignment | null = null
        try {
            storedAssignment = await storage.get()
        } catch {
            // 动画装饰不能阻止正式任务；存储恢复失败时只回退本次内存选择。
        }
        if (storedAssignment?.taskId === taskId) {
            return storedAssignment.variant
        }

        const variant = selectAnalysisRitualVariant(random)
        try {
            await storage.set({ taskId, variant })
        } catch {
            // localStorage 不可用时仍保留当前页面内的稳定选择。
        }
        return variant
    }

    return {
        getOrAssign(taskId) {
            const result = operationQueue.catch(() => undefined).then(() => getOrCreate(taskId))
            operationQueue = result.then(
                () => undefined,
                () => undefined,
            )
            return result
        },
    }
}
