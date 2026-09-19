import {
    abandonAnalysisTask,
    getAnalysisTask,
    getAnalysisTasks,
    reanalyzeAnalysisTask,
    retryAnalysisTask,
} from '@/api/analysis'
import type { AnalysisTaskLifecycleAdapter } from './useAnalysisTaskLifecycle'

/** 浏览器工作台的分析任务 HTTP 适配器。 */
export const browserAnalysisTaskLifecycleAdapter: AnalysisTaskLifecycleAdapter = {
    /**
     * 读取当前账号可见的分析任务列表，供任务生命周期模块统一同步远端状态。
     */
    async listTasks() {
        const response = await getAnalysisTasks()
        return response.data.data.tasks
    },
    /**
     * 读取当前账号指定分析任务的最新状态和结果。
     * @param taskId 目标分析任务 ID
     */
    async getTask(taskId) {
        const response = await getAnalysisTask(taskId)
        return response.data.data.task
    },
    /**
     * 请求放弃当前账号指定的资料搜集、排队或执行中任务。
     * @param taskId 目标分析任务 ID
     */
    async abandonTask(taskId) {
        const response = await abandonAnalysisTask(taskId)
        return response.data.data.task
    },
    /**
     * 请求将最终技术失败的任务重新加入分析队列。
     * @param taskId 目标分析任务 ID
     */
    async retryTask(taskId) {
        const response = await retryAnalysisTask(taskId)
        return response.data.data.task
    },
    /**
     * 请求基于原共享草稿创建一个全新分析任务。
     * @param taskId 源任务 ID
     */
    async reanalyzeTask(taskId, submissionId) {
        const response = await reanalyzeAnalysisTask(taskId, submissionId)
        return response.data.data.task
    },
}
