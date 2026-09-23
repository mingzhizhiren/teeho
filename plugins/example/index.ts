import type { TeehoPlugin } from '../sdk'
import { exampleSource } from './source'
import { shapeMetric, growthMetric } from './metrics'
import { exampleAlgorithms } from './algorithms'

/** 教学示例使用统一的插件注册格式。 */
export const examplePlugin: TeehoPlugin = {
    id: 'example',
    version: '1.2.0',
    sources: [exampleSource],
    metrics: [shapeMetric, growthMetric],
    algorithms: exampleAlgorithms,
}
export default examplePlugin
