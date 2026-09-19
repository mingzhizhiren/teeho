import type { AgentProvider, AgentProviderCorrelation } from '../providers/analysis.provider'
import type {
    AnalysisWebResearchInput,
    AnalysisWebResearchQueryPlan,
} from './analysis.web-research'

/** 正式分析前资料搜集所需的受控输入。 */
export interface WebResearchCollectionInput {
    researchInput: AnalysisWebResearchInput
    queryPlan: AnalysisWebResearchQueryPlan
    tokenBudget: number
    signal: AbortSignal
    correlation: AgentProviderCorrelation
}

/** 外部资料获取接口；不承担内容决策、量化或业务状态写入。 */
export interface WebResearchProvider {
    collect(input: WebResearchCollectionInput): Promise<unknown>
}

/** 分析进程使用的内容决策与可选资料搜集接口集合。 */
export interface AnalysisProviders {
    readonly agent: AgentProvider
    readonly webResearch: WebResearchProvider | null
}

/** 判断传输适配器是否同时提供资料搜集能力。 */
export function isWebResearchProvider(value: unknown): value is WebResearchProvider {
    if (typeof value !== 'object' || value === null) return false
    return typeof (value as Partial<WebResearchProvider>).collect === 'function'
}
