import {
    previewAnalysisDraft,
    recoverAnalysisTaskAdmission,
    submitAnalysisTask,
} from '@/api/analysis'
import { createEffectiveInputFingerprint } from './effectiveInputFingerprint'
import { estimateBrowserStorageCapacity } from './storageCapacity'
import type { AnalysisSubmissionAdapter } from './analysis.submission'

/** 浏览器工作台使用的 HTTP、指纹、Storage API 与随机数适配器。 */
export const browserAnalysisSubmissionAdapter: AnalysisSubmissionAdapter = {
    /**
     * 把标准化草稿和图片提交到预览接口，并返回服务端受理判断。
     * @param payload 标准化后的分析草稿载荷
     * @param timeoutMs 请求超时时间（毫秒）
     */
    async preview(payload, timeoutMs) {
        const response = await previewAnalysisDraft(payload, timeoutMs)
        return response.data.data
    },
    /**
     * 把标准化草稿和图片提交为正式分析任务。
     * @param payload 标准化后的分析草稿载荷
     * @param options 请求幂等标识和超时配置
     */
    async submit(payload, options) {
        const response = await submitAnalysisTask(payload, options)
        return response.data.data
    },
    recover: recoverAnalysisTaskAdmission,
    fingerprint: createEffectiveInputFingerprint,
    estimateCapacity: estimateBrowserStorageCapacity,
    randomUUID: () => crypto.randomUUID(),
}
