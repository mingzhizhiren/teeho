import {
    analysisEvidenceSetSchema,
    type AnalysisEvidenceSource,
} from '../analysis/evidence/analysis.evidence'
import type { DataSource } from './contract'
import { PluginError } from './errors'
import { freezeData } from './immutable'
import {
    checkupTopicEvidenceSchema,
    type CheckupTopicEvidenceSource,
} from '../analysis/checkup/analysis.checkup.topics'

function protectedInput<T extends { readonly task: object }>(input: T): T {
    return Object.freeze({ ...input, task: freezeData(structuredClone(input.task)) })
}

/** 话题源的技术异常必须进入失败结算，明确的不可用状态仍可交付。 */
export function validateTopicSource(source: DataSource): CheckupTopicEvidenceSource | undefined {
    const loadTopics = source.loadTopics
    if (loadTopics === undefined) return undefined
    if (typeof loadTopics !== 'function') throw new PluginError(source.id, 'invalid_topic_source')
    return {
        async load(input) {
            input.signal.throwIfAborted()
            try {
                const result = checkupTopicEvidenceSchema.parse(
                    await loadTopics(protectedInput(input)),
                )
                const cutoff = Date.parse(input.asOf)
                if (
                    Date.parse(result.asOf) > cutoff ||
                    result.topics.some(
                        (topic) =>
                            Date.parse(topic.observedAt) > cutoff ||
                            (topic.previousObservedAt !== null &&
                                Date.parse(topic.previousObservedAt) >=
                                    Date.parse(topic.observedAt)),
                    )
                )
                    throw new Error('invalid_topic_observation')
                input.signal.throwIfAborted()
                return result
            } catch {
                input.signal.throwIfAborted()
                throw new PluginError(source.id, 'topic_source_failed')
            }
        },
    }
}

/** 验证统一事实及扩展字段，不泄露来源异常。 */
export function validateSource(source: DataSource): AnalysisEvidenceSource {
    if (typeof source.load !== 'function') throw new PluginError(source.id, 'invalid_source')
    for (const [key, schema] of Object.entries(source.extensions ?? {})) {
        if (
            !/^[a-z][a-zA-Z0-9._-]*\/[a-zA-Z0-9._-]+$/u.test(key) ||
            typeof schema?.parse !== 'function'
        )
            throw new PluginError(source.id, 'invalid_fact_schema')
    }
    return {
        async load(input) {
            input.signal.throwIfAborted()
            try {
                const evidence = analysisEvidenceSetSchema.parse(
                    await source.load(protectedInput(input)),
                )
                const extensions = evidence.extensions ?? {}
                for (const key of Object.keys(extensions)) {
                    if (!source.extensions?.[key]) throw new Error('undeclared_extension')
                }
                const validated = Object.fromEntries(
                    Object.entries(source.extensions ?? {}).map(([key, schema]) => [
                        key,
                        schema.parse(extensions[key]),
                    ]),
                )
                const cutoff = Date.parse(input.asOf ?? evidence.selectedAt)
                if (Date.parse(evidence.selectedAt) > cutoff) throw new Error('future_evidence')
                for (const note of evidence.notes) {
                    const observedTimes = [
                        note.contentObservedAt,
                        note.authorObservedAt,
                        note.coverObservedAt,
                        note.firstImportedAt,
                    ].filter((time): time is string => Boolean(time))
                    if (observedTimes.some((time) => Date.parse(time) > cutoff))
                        throw new Error('future_evidence')
                    if (
                        Date.parse(note.publishedAt) > cutoff ||
                        Date.parse(note.observedAt) > cutoff ||
                        note.observations.some(
                            (observation) =>
                                Date.parse(observation.observedAt) > cutoff ||
                                Date.parse(observation.observedAt) < Date.parse(note.publishedAt),
                        )
                    )
                        throw new Error('invalid_observation')
                }
                input.signal.throwIfAborted()
                return {
                    ...evidence,
                    ...(Object.keys(validated).length ? { extensions: validated } : {}),
                }
            } catch {
                input.signal.throwIfAborted()
                throw new PluginError(source.id, 'source_failed')
            }
        },
    }
}
