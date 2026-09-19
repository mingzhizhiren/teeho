import { PERFORMANCE } from '@teeho/content-metrics'
import { z } from 'zod'
import { checkupOutputConstraints } from '../checkup/analysis.checkup.constants'

const METRIC_COUNT = 6

const value = z.number().finite().nonnegative().nullable()
export const dailyStatsSchema = z
    .object({
        observationDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        trackCode: z.number().int().min(0).max(checkupOutputConstraints.maximumTrackCode),
        metricCode: z.enum([
            'note_likes',
            'note_collects',
            'note_comments',
            'note_shares',
            'topic_joins',
            'topic_views',
        ]),
        entityCount: z.number().int().nonnegative(),
        sampleCount: z.number().int().nonnegative(),
        mean: value,
        median: value,
        sum: value,
        stddev: value,
        sourceMaxObservedAt: z.string().datetime({ offset: true }).nullable(),
        computedAt: z.string().datetime({ offset: true }),
    })
    .strict()
export type DailyStats = z.infer<typeof dailyStatsSchema>
export const maintenanceStatsSchema = z
    .object({
        status: z.enum(['available', 'no_sources', 'failed']),
        window: z.literal('shanghai-04-to-04'),
        metrics: z
            .array(dailyStatsSchema.extend({ skewSignal: z.number().finite().nullable() }))
            .max(METRIC_COUNT),
    })
    .strict()

/** 维护窗口仅用于覆盖及偏斜审计，不冒充自然日子群或用正态分布推算百分位。 */
export async function loadMaintenanceStats(
    load: (() => Promise<DailyStats[]>) | undefined,
    signal: AbortSignal,
): Promise<z.infer<typeof maintenanceStatsSchema>> {
    if (!load) return { status: 'no_sources', window: 'shanghai-04-to-04', metrics: [] }
    try {
        const rows = z.array(dailyStatsSchema).parse(
            await load().catch((error: unknown) => {
                if (signal.aborted) throw error
                return load()
            }),
        )
        if (signal.aborted) throw signal.reason
        return maintenanceStatsSchema.parse({
            status: rows.length ? 'available' : 'no_sources',
            window: 'shanghai-04-to-04',
            metrics: rows.map((row) => ({
                ...row,
                skewSignal:
                    row.sampleCount >= PERFORMANCE.minimumSamples &&
                    row.stddev &&
                    row.mean !== null &&
                    row.median !== null
                        ? (row.mean - row.median) / row.stddev
                        : null,
            })),
        })
    } catch (error) {
        if (signal.aborted) throw error
        return { status: 'failed', window: 'shanghai-04-to-04', metrics: [] }
    }
}
