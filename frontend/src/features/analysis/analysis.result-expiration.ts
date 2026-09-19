import { analysisUiConstraints } from './analysis.constants'

/** 判断本地历史结果是否已经超过服务端可重用期限。 */
export function isAnalysisResultExpired(savedAt: string | null, now: number): boolean {
    if (!savedAt) return false
    const savedAtMs = Date.parse(savedAt)
    if (!Number.isFinite(savedAtMs)) return false
    return now >= savedAtMs + analysisUiConstraints.resultActionRetentionMs
}
