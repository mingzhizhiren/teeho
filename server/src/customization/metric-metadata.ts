import { z } from 'zod'
import type { DataMetric, MetricComputation } from './contract'
import type { AnalysisEvidenceSet } from '../analysis/evidence/analysis.evidence'

const LIMITS = { identity: 128, unit: 40 } as const
const timestamp = z.string().datetime({ offset: true })

/** 区分查询分析窗口与实际观察范围，避免将两种时间口径混用。 */
export const metricWindowSchema = z
    .object({
        kind: z.enum(['analysis', 'observations']),
        start: timestamp,
        end: timestamp,
    })
    .strict()
    .refine((window) => Date.parse(window.start) <= Date.parse(window.end), 'Invalid metric window')

const cohortSchema = z
    .object({
        sampleCount: z.number().int().nonnegative().safe(),
        window: metricWindowSchema.nullable(),
    })
    .strict()

/** 统计模块返回实际参与计算的样本数；独立子群保留各自窗口。 */
export const metricBasisSchema = cohortSchema
    .extend({
        cohorts: z.record(z.string().min(1).max(LIMITS.identity), cohortSchema).optional(),
    })
    .strict()
export type MetricBasis = z.infer<typeof metricBasisSchema>

export const metricMetadataSchema = z
    .object({
        kind: z.enum(['feature', 'statistic']),
        unit: z.string().max(LIMITS.unit),
        metricVersion: z.string().min(1).max(LIMITS.identity),
        asOf: timestamp,
        sourceVersion: z.string().min(1).max(LIMITS.identity),
        evidenceVersion: z.string().regex(/^[0-9a-f]{64}$/u),
        sampleCount: z.number().int().nonnegative().safe().nullable(),
        window: metricWindowSchema.nullable(),
        cohorts: metricBasisSchema.shape.cohorts,
    })
    .strict()
    .superRefine((metadata, context) => {
        if (metadata.kind === 'statistic' && metadata.sampleCount === null)
            context.addIssue({ code: 'custom', message: 'Missing sample count' })
        const windows = [
            metadata.window,
            ...Object.values(metadata.cohorts ?? {}).map((cohort) => cohort.window),
        ]
        if (windows.some((window) => window && Date.parse(window.end) > Date.parse(metadata.asOf)))
            context.addIssue({ code: 'custom', message: 'Metric evidence exceeds cutoff' })
    })
export type MetricMetadata = z.infer<typeof metricMetadataSchema>

/** 单位、实现版本、截止时间与证据身份由宿主绑定，不采信插件自报身份。 */
export function createMetricMetadata(
    definition: DataMetric,
    output: MetricComputation,
    evidence: AnalysisEvidenceSet,
): MetricMetadata {
    const basis = definition.kind === 'statistic' ? metricBasisSchema.parse(output.basis) : null
    if (definition.kind === 'feature' && output.basis !== undefined)
        throw new Error('Feature cannot claim a statistical basis')
    if (basis && output.status === 'available' && !basis.window)
        throw new Error('Available statistic requires a window')
    return metricMetadataSchema.parse({
        kind: definition.kind,
        unit: definition.unit,
        metricVersion: definition.version,
        asOf: evidence.selectedAt,
        sourceVersion: evidence.sourceVersion,
        evidenceVersion: evidence.evidenceVersion,
        sampleCount: basis?.sampleCount ?? null,
        window: basis?.window ?? null,
        ...(basis?.cohorts ? { cohorts: basis.cohorts } : {}),
    })
}
