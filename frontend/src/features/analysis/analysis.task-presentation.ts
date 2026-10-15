import type { AnalysisTask } from './analysis.contract'

export type AnalysisTaskStatusTranslationKey =
    | AnalysisTask['status']
    | 'maintenance_cancelled'
    | 'no_reference_notes'
    | 'media_preparing'

export function analysisTaskStatusTranslationKey(
    task: Pick<AnalysisTask, 'status' | 'cancellationReason'> &
        Partial<Pick<AnalysisTask, 'failure' | 'preparationStatus'>>,
): AnalysisTaskStatusTranslationKey {
    if (task.status === 'queued' && task.preparationStatus === 'waiting') return 'media_preparing'
    if (task.status === 'technical_failed' && task.failure?.code === 'no_reference_notes')
        return 'no_reference_notes'
    return task.status === 'cancelled' && task.cancellationReason === 'maintenance'
        ? 'maintenance_cancelled'
        : task.status
}
