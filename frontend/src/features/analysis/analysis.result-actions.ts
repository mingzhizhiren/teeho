import type { ComputedRef, Ref } from 'vue'

import type { AnalysisTask } from './analysis.contract'

interface AnalysisResultActionsOptions {
    task: Ref<AnalysisTask | null>
    busy: Readonly<Ref<boolean>>
    canRun: Readonly<ComputedRef<boolean>>
    reanalyzeCurrent: () => Promise<void>
    onTaskStarted: (task: AnalysisTask) => void
}

interface AnalysisResultActions {
    reanalyze: () => Promise<void>
}

/** 封装再次体检确认后的新任务切换，不恢复过期素材。 */
export function createAnalysisResultActions(
    options: AnalysisResultActionsOptions,
): AnalysisResultActions {
    return {
        async reanalyze() {
            const sourceTask = options.task.value
            if (!sourceTask || options.busy.value || !options.canRun.value) return
            await options.reanalyzeCurrent()
            const reanalysisTask = options.task.value
            if (reanalysisTask && reanalysisTask.id !== sourceTask.id) {
                options.onTaskStarted(reanalysisTask)
            }
        },
    }
}
