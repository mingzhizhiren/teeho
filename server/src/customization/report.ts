import { z } from 'zod'

/** 保存报告中的自定义展示项；字符串由插件提供。 */
export const customMetricLimits = {
    count: 20,
    id: 128,
    name: 120,
    unit: 40,
    description: 800,
    text: 800,
} as const
export const customMetricSchema = z
    .object({
        id: z.string().min(1).max(customMetricLimits.id),
        name: z.string().min(1).max(customMetricLimits.name),
        description: z.string().max(customMetricLimits.description),
        unit: z.string().max(customMetricLimits.unit),
        status: z.enum(['available', 'unavailable']),
        value: z.union([z.number().finite(), z.string().max(customMetricLimits.text), z.null()]),
        metricVersion: z.string().min(1).max(customMetricLimits.id),
        evidenceVersion: z.string().min(1).max(customMetricLimits.id),
        asOf: z.string().datetime({ offset: true }),
    })
    .strict()
    .superRefine((item, ctx) => {
        if ((item.status === 'unavailable') !== (item.value === null))
            ctx.addIssue({ code: 'custom', message: 'Invalid metric availability' })
    })
export type CustomMetric = z.infer<typeof customMetricSchema>
