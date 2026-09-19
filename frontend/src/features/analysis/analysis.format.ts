import type { TaskFieldDefinition, TaskFieldValue } from './analysis.contract'
import { analysisUiConstraints } from './analysis.constants'

/** 用户可见评分统一使用十分制，内部报告继续保留原始精度。 */
export const analysisDisplayScoreMaximum = 10
const SCORE_FLOAT_PRECISION = 12
const SCORE_DECIMAL_BASE = 10

/** 将报告百分制分数转换为十分制，并按十进制四舍五入保留两位。 */
export function formatAnalysisScore(score: number): string {
    const scaled = (score / analysisUiConstraints.scoreMaximum) * analysisDisplayScoreMaximum
    const places = analysisUiConstraints.scoreDisplayDecimalPlaces
    const rounded = Math.round(Number(`${scaled.toFixed(SCORE_FLOAT_PRECISION)}e${places}`))
    return (rounded / SCORE_DECIMAL_BASE ** places).toFixed(places)
}

type Translate = (key: string) => string

/** 将任务字段值转换为工作台统一展示文本 */
export function formatTaskFieldValue(
    value: TaskFieldValue | undefined,
    translate: Translate,
    field?: TaskFieldDefinition,
): string {
    if (Array.isArray(value)) {
        return value.length > 0
            ? value.join(translate('workspace.fields.listSeparator'))
            : translate('workspace.fields.autoPlaceholder')
    }
    if (typeof value === 'string' && field?.kind === 'select') {
        const optionLabelKey = field.options?.find((option) => option.value === value)?.labelKey
        const labelKey = optionLabelKey
        return labelKey ? translate(labelKey) : value.replace(/_/gu, ' ')
    }
    return value ?? translate('workspace.fields.autoPlaceholder')
}
