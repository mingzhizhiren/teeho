import type { TeehoPlugin } from '../sdk'
import { exampleSource } from './source'
import { shapeMetric, growthMetric } from './metrics'
import { exampleAlgorithms } from './algorithms'

/** 社区教学实现与私有插件使用相同注册格式。 */
export const examplePlugin: TeehoPlugin = {
    id: 'example',
    version: '1.2.0',
    sources: [exampleSource],
    metrics: [shapeMetric, growthMetric],
    algorithms: exampleAlgorithms,
}
export default examplePlugin
