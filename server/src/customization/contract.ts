import { z } from 'zod'
import type {
    AnalysisEvidenceSet,
    AnalysisEvidenceSource,
} from '../analysis/evidence/analysis.evidence'
import type { StandardAnalysisTask } from '../analysis/analysis.schema'
import type { RadarMetric, RadarScores } from '../analysis/checkup/analysis.radar'
import type { AnalysisEvidenceSourceInput } from '../analysis/evidence/analysis.evidence'
import type {
    CheckupTopicEvidenceSource,
    CheckupTopicEvidence,
    CheckupTopic,
} from '../analysis/checkup/analysis.checkup.topics'
import type { CustomMetric } from './report'
import type { MetricBasis, MetricMetadata } from './metric-metadata'
import type { ReadonlyData } from './immutable'

export interface DisplayMetric {
    readonly id: string
    readonly name: string
    readonly description?: string
}

/** 开发者自行取得事实，宿主校验输出。 */
export interface DataSource {
    readonly id: string
    readonly version: string
    readonly extensions?: Readonly<Record<string, z.ZodType<unknown>>>
    readonly load: (input: AnalysisEvidenceSourceInput) => Promise<unknown>
    readonly loadTopics?: (
        input: Parameters<CheckupTopicEvidenceSource['load']>[0],
    ) => Promise<unknown>
}

/** 插件只接触本次笔记与冻结事实，不接触账号或积分。 */
export interface MetricContext {
    readonly topicEvidence?: CheckupTopicEvidence
    readonly matchedTopicIds?: readonly string[]
    readonly evidence: Omit<AnalysisEvidenceSet, 'extensions'>
    readonly task: StandardAnalysisTask
    readonly signal: AbortSignal
    readonly metric: (id: string) => MetricValue
    readonly fact: (id: string) => unknown
}

/** 缺失与合法零值分离；统计口径由指标声明。 */
export type MetricComputation = (
    | { readonly status: 'available'; readonly value: unknown }
    | { readonly status: 'unavailable'; readonly reason: string }
) & { readonly basis?: MetricBasis }
export type MetricValue = MetricComputation & { readonly metadata: ReadonlyData<MetricMetadata> }

export interface DataMetric {
    readonly id: string
    readonly kind: 'feature' | 'statistic'
    readonly version: string
    readonly unit: string
    readonly description: string
    readonly requires: readonly string[]
    readonly requiresFacts?: readonly string[]
    readonly schema: z.ZodType<unknown>
    readonly compute: (input: MetricContext) => MetricComputation | Promise<MetricComputation>
}

export interface RadarAlgorithm {
    readonly id: string
    readonly dimension: RadarMetric
    readonly requires: readonly string[]
    readonly evaluate: (
        input: Pick<MetricContext, 'task' | 'signal' | 'metric'>,
    ) => unknown | Promise<unknown>
}

/** 一个插件可以提供指标和/或固定维度算法。 */
export interface TeehoPlugin {
    readonly id: string
    readonly version: string
    readonly metrics?: readonly DataMetric[]
    readonly algorithms?: readonly RadarAlgorithm[]
    readonly sources?: readonly DataSource[]
}

export interface PluginConfiguration {
    readonly plugins: readonly TeehoPlugin[]
    readonly dataSource: AnalysisEvidenceSource | string
    readonly algorithms: Readonly<Record<RadarMetric, string>>
    readonly displayMetrics?: readonly DisplayMetric[]
}

/** 宿主只使用这一执行入口，不区分官方与自定义实现。 */
export interface PluginRuntime {
    readonly version: string
    readonly dataSource: AnalysisEvidenceSource
    readonly topicSource?: CheckupTopicEvidenceSource
    readonly evaluate: (
        evidence: AnalysisEvidenceSet,
        task: StandardAnalysisTask,
        signal: AbortSignal,
        context?: Pick<MetricContext, 'topicEvidence' | 'matchedTopicIds'>,
    ) => Promise<{
        radar: RadarScores
        customMetrics: CustomMetric[]
        metricEvidence: Readonly<Record<string, MetricMetadata>>
        topicSupport: {
            status: CheckupTopicEvidence['status']
            bonus: number
            matchedTopics: CheckupTopic[]
        }
    }>
}

/** 插件作者使用与宿主相同的 schema 工具。 */
export { z }
