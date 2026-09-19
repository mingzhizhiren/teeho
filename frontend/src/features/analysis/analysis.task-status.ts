import type { AnalysisTask } from './analysis.contract'

/** 后端仍在推进的正式分析阶段；所有工作台消费者共享这一份定义。 */
export const activeAnalysisTaskStatuses = [
    'researching',
    'queued',
    'processing',
    'retrying',
] as const satisfies readonly AnalysisTask['status'][]

const activeAnalysisTaskStatusSet = new Set<AnalysisTask['status']>(activeAnalysisTaskStatuses)

export function isActiveAnalysisTaskStatus(status: AnalysisTask['status']) {
    return activeAnalysisTaskStatusSet.has(status)
}

/** 从账号任务列表中读取当前唯一允许的活动任务。 */
export function findActiveAnalysisTask<Task extends { readonly status: AnalysisTask['status'] }>(
    tasks: readonly Task[],
) {
    return tasks.find((task) => isActiveAnalysisTaskStatus(task.status)) ?? null
}

/** 活动任务仍依赖本地记录承接状态，只有终态可以删除本地历史。 */
export function canDeleteAnalysisLocalHistory(status: AnalysisTask['status']) {
    return !isActiveAnalysisTaskStatus(status)
}

/** 兼容现有失败终态；界面还需按失败原因判断重试是否有意义。 */
export function canRetryAnalysisTaskStatus(status: AnalysisTask['status']) {
    return status === 'technical_failed'
}
