/** 定制入口，只导出插件契约与宿主能力。 */
export { z } from '../server/src/customization/contract'
export type { MetricBasis, MetricMetadata } from '../server/src/customization/metric-metadata'
export type {
    TeehoPlugin,
    DataSource,
    DataMetric,
    RadarAlgorithm,
    PluginConfiguration,
    MetricValue,
    MetricComputation,
    MetricContext,
} from '../server/src/customization/contract'
export { createPluginRuntime } from '../server/src/customization/runtime'
export { createJsonSource } from '../server/src/customization/json-source'
export { radarMetricNames } from '../server/src/analysis/checkup/analysis.radar'
