import { z } from 'zod'
import { structureMetricNames } from './analysis.structure-metrics'

const COMPARISON_CAPACITY = {
    'report-access.v1': 4,
    'report-access.v2': 8,
    'report-access.v3': 10,
} as const
const MAXIMUM_COMPARISON_NOTES = COMPARISON_CAPACITY['report-access.v3']
const MAXIMUM_ACCESS_FOOTER_LENGTH = 200

/** 服务端冻结的报告展示权限；旧报告无此字段时保留原有内容。 */
export const reportAccessSchema = z
    .object({
        version: z.enum(['report-access.v1', 'report-access.v2', 'report-access.v3']),
        sections: z
            .object({
                contentAnalysis: z
                    .object({
                        enabled: z.boolean(),
                        indicators: z
                            .object({
                                consistency: z.boolean(),
                                advice: z.boolean(),
                                weaknesses: z.boolean(),
                                termRisks: z.boolean(),
                            })
                            .strict(),
                    })
                    .strict(),
                structureMetrics: z
                    .object({
                        enabled: z.boolean(),
                        indicators: z.record(z.enum(structureMetricNames), z.boolean()),
                    })
                    .strict(),
                comparisonNotes: z
                    .object({
                        enabled: z.boolean(),
                        limit: z.number().int().min(0).max(MAXIMUM_COMPARISON_NOTES),
                    })
                    .strict(),
            })
            .strict(),
        footer: z.string().trim().min(1).max(MAXIMUM_ACCESS_FOOTER_LENGTH).nullable(),
    })
    .strict()
    .superRefine((access, context) => {
        if (access.sections.comparisonNotes.limit > COMPARISON_CAPACITY[access.version]) {
            context.addIssue({
                code: 'custom',
                path: ['sections', 'comparisonNotes', 'limit'],
                message: 'Invalid legacy comparison limit',
            })
        }
    })

export type ReportAccess = z.infer<typeof reportAccessSchema>
export type ContentIndicator = keyof ReportAccess['sections']['contentAnalysis']['indicators']
export type ReportSection = keyof ReportAccess['sections']

/** 完全开放的报告仍执行原有完整评分校验，不能利用权限标记绕开。 */
export function hasFullReportAccess(access: ReportAccess): boolean {
    return (
        Object.values(access.sections).every((section) => section.enabled) &&
        Object.values(access.sections.contentAnalysis.indicators).every(Boolean) &&
        Object.values(access.sections.structureMetrics.indicators).every(Boolean) &&
        access.sections.comparisonNotes.limit === COMPARISON_CAPACITY[access.version]
    )
}

/** 展示和复制共用结果项权限，不查询当前套餐以免改变历史报告。 */
export function canShowReportSection(
    access: ReportAccess | undefined,
    section: ReportSection,
): boolean {
    if (!access) return true
    const selected = access.sections[section]
    if (!selected.enabled) return false
    return 'indicators' in selected
        ? Object.values(selected.indicators).some(Boolean)
        : selected.limit > 0
}

/** 内容分析的指标权限；缺失权限标记代表历史完整报告。 */
export function canShowContentIndicator(
    access: ReportAccess | undefined,
    indicator: ContentIndicator,
): boolean {
    return (
        !access ||
        (access.sections.contentAnalysis.enabled &&
            access.sections.contentAnalysis.indicators[indicator])
    )
}

/** 结构指标的显示白名单，同时用于页面与文本导出。 */
export function canShowStructureMetric(
    access: ReportAccess | undefined,
    metric: (typeof structureMetricNames)[number],
): boolean {
    return (
        !access ||
        (access.sections.structureMetrics.enabled &&
            access.sections.structureMetrics.indicators[metric])
    )
}
