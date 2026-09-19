import { z } from 'zod'

import type { ReadonlyData } from '../../customization/immutable'
import type { StandardAnalysisTask } from '../analysis.schema'

/** 经典话题只供 Agent 使用；加分不随标签数量叠加。 */
export const checkupTopicConstraints = {
    maximumTrack: 30,
    trackSlots: 4,
    candidateLimit: 100,
    matchLimit: 5,
    titleMaxLength: 200,
    idMaxLength: 128,
    freshnessMs: 604_800_000,
    demandBonus: 5,
    timingBonus: 5,
} as const

const countSchema = z.number().int().nonnegative().safe()
export const checkupTopicSchema = z
    .object({
        topicId: z.string().trim().min(1).max(checkupTopicConstraints.idMaxLength),
        trackCodes: z
            .array(z.number().int().min(0).max(checkupTopicConstraints.maximumTrack))
            .max(checkupTopicConstraints.trackSlots)
            .optional(),
        title: z.string().trim().min(1).max(checkupTopicConstraints.titleMaxLength),
        observedAt: z.string().datetime(),
        joinCount: countSchema,
        viewCount: countSchema,
        previousObservedAt: z.string().datetime().nullable(),
        joinDelta: z.number().int().safe().nullable(),
        viewDelta: z.number().int().safe().nullable(),
    })
    .strict()
export type CheckupTopic = z.infer<typeof checkupTopicSchema>

export const checkupTopicEvidenceSchema = z
    .object({
        status: z.enum(['collected', 'no_sources', 'failed']),
        asOf: z.string().datetime(),
        topics: z.array(checkupTopicSchema).max(checkupTopicConstraints.candidateLimit),
    })
    .strict()
export type CheckupTopicEvidence = z.infer<typeof checkupTopicEvidenceSchema>

/** 题火读取现成话题观察，不执行采集。 */
export interface CheckupTopicEvidenceSource {
    load(input: {
        readonly task: ReadonlyData<StandardAnalysisTask>
        readonly asOf: string
        readonly signal: AbortSignal
    }): Promise<CheckupTopicEvidence>
}

export const checkupTopicSupportSchema = z
    .object({
        status: z.enum(['collected', 'no_sources', 'failed']),
        matchedTopics: z.array(checkupTopicSchema).max(checkupTopicConstraints.matchLimit),
        bonuses: z
            .object({
                topicDemand: z.number().min(0).max(checkupTopicConstraints.demandBonus),
                differentiationTiming: z.number().min(0).max(checkupTopicConstraints.timingBonus),
            })
            .strict(),
    })
    .strict()

/** 核对命中 ID 与观察时间；增长还需独立、近期的前一次观察。 */
export function matchedCheckupTopics(
    evidence: CheckupTopicEvidence,
    ids: readonly string[],
): CheckupTopic[] {
    if (evidence.status !== 'collected') return []
    const cutoff = Date.parse(evidence.asOf)
    return evidence.topics
        .filter((topic) => {
            const age = cutoff - Date.parse(topic.observedAt)
            return (
                ids.includes(topic.topicId) &&
                age >= 0 &&
                age <= checkupTopicConstraints.freshnessMs
            )
        })
        .filter(
            (topic, index, topics) =>
                topics.findIndex((candidate) => candidate.topicId === topic.topicId) === index,
        )
        .slice(0, checkupTopicConstraints.matchLimit)
}

/** 累计规模不等于增长，仅可比较两个真实观察。 */
export function hasRecentCheckupTopicGrowth(topic: CheckupTopic): boolean {
    if (!topic.previousObservedAt) return false
    const interval = Date.parse(topic.observedAt) - Date.parse(topic.previousObservedAt)
    return (
        interval > 0 &&
        interval <= checkupTopicConstraints.freshnessMs &&
        ((topic.joinDelta ?? 0) > 0 || (topic.viewDelta ?? 0) > 0)
    )
}
