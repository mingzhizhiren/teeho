import { radarMetricNames, type PluginConfiguration } from '../sdk'
import { examplePlugin } from './index'

/** 社区默认装配；由部署者选择一个来源、六个算法与展示指标。 */
const configuration: PluginConfiguration = {
    plugins: [examplePlugin],
    dataSource: 'example/json',
    algorithms: Object.fromEntries(
        radarMetricNames.map((dimension) => [dimension, `example/${dimension}`]),
    ) as PluginConfiguration['algorithms'],
    displayMetrics: [{ id: 'example/collection-growth', name: '示例收藏增长' }],
}
export default configuration
