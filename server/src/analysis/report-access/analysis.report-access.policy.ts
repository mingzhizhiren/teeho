import { z } from 'zod'
import { checkupOutputConstraints } from '../checkup/analysis.checkup.constants'
import {
    CONTENT_ANALYSIS_INDICATORS,
    STRUCTURE_METRIC_INDICATORS,
} from './analysis.report-access.registry'

const MAX_FOOTER_LENGTH = 200
const REFERENCE_LIMIT_BY_VERSION = {
    'report-access.v1': 4,
    'report-access.v2': 8,
    'report-access.v3': checkupOutputConstraints.maxReferences,
} as const

function indicatorSchema<T extends Record<string, unknown>>(registry: T) {
    const entries = Object.fromEntries(Object.keys(registry).map((key) => [key, z.boolean()]))
    return z.object(entries as Record<keyof T & string, z.ZodBoolean>).strict()
}

/** 权限随报告冻结；未知字段、遗漏的指标开关及超额篇数一律拒绝。 */
export const reportAccessPolicySchema = z
    .object({
        version: z.enum(['report-access.v1', 'report-access.v2', 'report-access.v3']),
        sections: z
            .object({
                contentAnalysis: z
                    .object({
                        enabled: z.boolean(),
                        indicators: indicatorSchema(CONTENT_ANALYSIS_INDICATORS),
                    })
                    .strict(),
                structureMetrics: z
                    .object({
                        enabled: z.boolean(),
                        indicators: indicatorSchema(STRUCTURE_METRIC_INDICATORS),
                    })
                    .strict(),
                comparisonNotes: z
                    .object({
                        enabled: z.boolean(),
                        limit: z.number().int().min(0).max(checkupOutputConstraints.maxReferences),
                    })
                    .strict(),
            })
            .strict(),
        footer: z.string().trim().min(1).max(MAX_FOOTER_LENGTH).nullable(),
    })
    .strict()
    .superRefine((value, context) => {
        if (value.sections.comparisonNotes.limit > REFERENCE_LIMIT_BY_VERSION[value.version])
            context.addIssue({
                code: 'custom',
                path: ['sections', 'comparisonNotes', 'limit'],
                message: 'Report access exceeds its versioned comparison limit',
            })
    })

export type ReportAccessPolicy = z.infer<typeof reportAccessPolicySchema>

function openIndicators<T extends Record<string, unknown>>(registry: T) {
    return Object.fromEntries(Object.keys(registry).map((key) => [key, true])) as Record<
        keyof T & string,
        boolean
    >
}

/** 社区版及已登录用户的默认范围；私有订阅配置可分别覆盖，不修改已保存历史。 */
export const FULL_REPORT_ACCESS: ReportAccessPolicy = reportAccessPolicySchema.parse({
    version: 'report-access.v3',
    sections: {
        contentAnalysis: { enabled: true, indicators: openIndicators(CONTENT_ANALYSIS_INDICATORS) },
        structureMetrics: {
            enabled: true,
            indicators: openIndicators(STRUCTURE_METRIC_INDICATORS),
        },
        comparisonNotes: { enabled: true, limit: checkupOutputConstraints.maxReferences },
    },
    footer: null,
})

/** Skill 匿名体验：只展示一篇对照，关闭独立建议及四个指定结构指标。 */
export const ANONYMOUS_SKILL_REPORT_ACCESS: ReportAccessPolicy = reportAccessPolicySchema.parse({
    ...FULL_REPORT_ACCESS,
    sections: {
        contentAnalysis: {
            enabled: true,
            indicators: {
                ...FULL_REPORT_ACCESS.sections.contentAnalysis.indicators,
                advice: false,
            },
        },
        structureMetrics: {
            enabled: true,
            indicators: {
                ...FULL_REPORT_ACCESS.sections.structureMetrics.indicators,
                imageCount: false, // 图片数量。
                videoDurationSeconds: false, // 视频时长。
                paragraphLength: false, // 平均段落长度。
                topicLength: false, // 平均话题长度。
            },
        },
        comparisonNotes: { enabled: true, limit: 1 },
    },
    footer: '🌐向agent发送：“登录题火”解锁显示更多诊断信息',
})

/** 判断权限是否完整开放；页尾文字不影响数据权限。 */
export function isFullReportAccess(policy: ReportAccessPolicy): boolean {
    const { contentAnalysis, structureMetrics, comparisonNotes } = policy.sections
    return (
        contentAnalysis.enabled &&
        Object.values(contentAnalysis.indicators).every(Boolean) &&
        structureMetrics.enabled &&
        Object.values(structureMetrics.indicators).every(Boolean) &&
        comparisonNotes.enabled &&
        comparisonNotes.limit === REFERENCE_LIMIT_BY_VERSION[policy.version]
    )
}
