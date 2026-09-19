import {
    z,
    type DataMetric,
    type MetricValue,
    type PluginConfiguration,
    type PluginRuntime,
    type RadarAlgorithm,
} from './contract'
import { radarMetricNames, radarScoresSchema, roundRadar } from '../analysis/checkup/analysis.radar'
import { validateSource, validateTopicSource } from './source'
import { PluginError } from './errors'
export { PluginError } from './errors'
import { customMetricSchema, customMetricLimits } from './report'
import { freezeData } from './immutable'
import { createHash } from 'node:crypto'
import {
    checkupTopicSchema,
    checkupTopicConstraints,
} from '../analysis/checkup/analysis.checkup.topics'
import { metricBasisSchema, createMetricMetadata } from './metric-metadata'

const topicSupportSchema = z
    .object({
        status: z.enum(['collected', 'no_sources', 'failed']),
        bonus: z.number().finite().min(0).max(1),
        matchedTopics: z.array(checkupTopicSchema).max(checkupTopicConstraints.matchLimit),
    })
    .strict()

const LIMITS = { identity: 128, reason: 256 } as const
const identity = z
    .string()
    .regex(/^[a-z][a-zA-Z0-9._/-]*$/u)
    .max(LIMITS.identity)
const metricValueSchema = z.discriminatedUnion('status', [
    z
        .object({
            status: z.literal('available'),
            value: z.unknown().refine((value) => value !== undefined),
            basis: metricBasisSchema.optional(),
        })
        .strict(),
    z
        .object({
            status: z.literal('unavailable'),
            reason: z.string().min(1).max(LIMITS.reason),
            basis: metricBasisSchema.optional(),
        })
        .strict(),
])

function unique<T extends { readonly id: string }>(items: readonly T[]): ReadonlyMap<string, T> {
    const entries = items.map((item) => [identity.parse(item.id), item] as const)
    if (new Set(entries.map(([id]) => id)).size !== entries.length)
        throw new PluginError('configuration', 'duplicate_id')
    return new Map(entries)
}

function validateDependencies(
    metrics: ReadonlyMap<string, DataMetric>,
    id: string,
    parents: readonly string[],
    facts?: ReadonlySet<string>,
): void {
    if (parents.includes(id)) throw new PluginError(id, 'circular_dependency')
    const metric = metrics.get(id)
    if (!metric) throw new PluginError(id, 'missing_metric')
    if (typeof metric.compute !== 'function' || typeof metric.schema?.parse !== 'function')
        throw new PluginError(id, 'invalid_metric')
    if (metric.kind !== 'feature' && metric.kind !== 'statistic')
        throw new PluginError(id, 'invalid_metric_kind')
    for (const fact of metric.requiresFacts ?? []) {
        identity.parse(fact)
        if (facts && !facts.has(fact)) throw new PluginError(fact, 'missing_fact')
    }
    for (const dependency of metric.requires)
        validateDependencies(metrics, dependency, [...parents, id], facts)
}

/** 验证配置后冻结执行组合；每次执行独立计算声明的指标。 */
export function createPluginRuntime(config: PluginConfiguration): PluginRuntime {
    unique(config.plugins)
    const sources = unique(
        config.plugins
            .flatMap((plugin) => plugin.sources ?? [])
            .map((item) => ({ ...item, extensions: { ...item.extensions } })),
    )
    const source =
        typeof config.dataSource === 'string' ? sources.get(config.dataSource) : undefined
    if (typeof config.dataSource === 'string' && !source)
        throw new PluginError(config.dataSource, 'missing_source')
    const directSource =
        typeof config.dataSource === 'object' && config.dataSource ? config.dataSource : undefined
    const dataSource = source
        ? validateSource(source)
        : directSource && typeof directSource.load === 'function'
          ? validateSource({
                id: 'configuration/source',
                version: '1',
                load: directSource.load.bind(directSource),
            })
          : config.dataSource
    if (typeof dataSource === 'string' || !dataSource || typeof dataSource.load !== 'function')
        throw new PluginError('configuration', 'invalid_source')
    const metrics = unique(
        config.plugins
            .flatMap((plugin) => plugin.metrics ?? [])
            .map((item) => ({
                ...item,
                requires: Object.freeze([...item.requires]),
                requiresFacts: Object.freeze([...(item.requiresFacts ?? [])]),
            })),
    )
    const algorithms = unique(
        config.plugins
            .flatMap((plugin) => plugin.algorithms ?? [])
            .map((item) => ({ ...item, requires: Object.freeze([...item.requires]) })),
    )
    for (const id of metrics.keys()) validateDependencies(metrics, id, [])
    const availableFacts = new Set(Object.keys(source?.extensions ?? {}))
    const displays = z
        .array(
            z
                .object({
                    id: identity,
                    name: z.string().min(1).max(customMetricLimits.name),
                    description: z.string().max(customMetricLimits.description).optional(),
                })
                .strict(),
        )
        .max(customMetricLimits.count)
        .parse(config.displayMetrics ?? [])
    unique(displays)
    for (const display of displays) validateDependencies(metrics, display.id, [], availableFacts)
    const selected = radarMetricNames.map((dimension) => {
        const algorithm = algorithms.get(config.algorithms[dimension])
        if (
            !algorithm ||
            algorithm.dimension !== dimension ||
            typeof algorithm.evaluate !== 'function'
        )
            throw new PluginError(dimension, 'missing_algorithm')
        for (const id of algorithm.requires) validateDependencies(metrics, id, [], availableFacts)
        return algorithm
    })
    return {
        version: createHash('sha256')
            .update(
                JSON.stringify({
                    plugins: config.plugins.map((plugin) => [plugin.id, plugin.version]),
                    algorithms: config.algorithms,
                    metrics: [...metrics.values()].map((metric) => [metric.id, metric.version]),
                }),
            )
            .digest('hex'),
        dataSource,
        topicSource: source ? validateTopicSource(source) : undefined,
        async evaluate(evidence, task, signal, context = {}) {
            evidence = freezeData(structuredClone(evidence))
            task = freezeData(structuredClone(task))
            context = freezeData(structuredClone(context))
            const { extensions = {}, ...standardEvidence } = evidence
            let topicSupport: z.infer<typeof topicSupportSchema> = {
                status: context.topicEvidence?.status ?? 'no_sources',
                bonus: 0,
                matchedTopics: [],
            }
            const values = new Map<string, MetricValue>()
            const read =
                (owner: DataMetric | RadarAlgorithm) =>
                (id: string): MetricValue => {
                    if (!owner.requires.includes(id) || !values.has(id))
                        throw new PluginError(owner.id, 'undeclared_dependency')
                    return values.get(id)!
                }
            const compute = async (id: string): Promise<void> => {
                if (values.has(id)) return
                signal.throwIfAborted()
                const definition = metrics.get(id)!
                for (const dependency of definition.requires) await compute(dependency)
                try {
                    const output = metricValueSchema.parse(
                        await definition.compute({
                            ...context,
                            evidence: Object.freeze(standardEvidence),
                            task,
                            signal,
                            metric: read(definition),
                            fact: (id) => {
                                if (!definition.requiresFacts.includes(id))
                                    throw new PluginError(id, 'undeclared_fact')
                                return freezeData(source!.extensions[id]!.parse(extensions[id]))
                            },
                        }),
                    )
                    const metadata = createMetricMetadata(definition, output, evidence)
                    const value =
                        output.status === 'available'
                            ? { ...output, value: definition.schema.parse(output.value), metadata }
                            : { ...output, metadata }
                    values.set(id, freezeData(value))
                } catch {
                    signal.throwIfAborted()
                    throw new PluginError(id, 'metric_failed')
                }
            }
            const entries = []
            for (const algorithm of selected) {
                for (const id of algorithm.requires) await compute(id)
                signal.throwIfAborted()
                try {
                    const raw = await algorithm.evaluate({ task, signal, metric: read(algorithm) })
                    const structured =
                        typeof raw === 'object' && raw !== null
                            ? z
                                  .object({
                                      score: radarScoresSchema.shape[algorithm.dimension],
                                      topicSupport: topicSupportSchema,
                                  })
                                  .strict()
                                  .parse(raw)
                            : null
                    if (structured) {
                        if (
                            algorithm.dimension !== 'topicDemand' ||
                            (structured.score === null && structured.topicSupport.bonus !== 0)
                        )
                            throw new PluginError(algorithm.id, 'invalid_topic_support')
                        topicSupport = structured.topicSupport
                    }
                    const score = radarScoresSchema.shape[algorithm.dimension].parse(
                        structured ? structured.score : raw,
                    )
                    signal.throwIfAborted()
                    entries.push([algorithm.dimension, score === null ? null : roundRadar(score)])
                } catch {
                    signal.throwIfAborted()
                    throw new PluginError(algorithm.id, 'algorithm_failed')
                }
            }
            const customMetrics = []
            for (const display of displays) {
                await compute(display.id)
                const result = values.get(display.id)!
                const definition = metrics.get(display.id)!
                try {
                    customMetrics.push(
                        customMetricSchema.parse({
                            id: display.id,
                            name: display.name,
                            description: display.description ?? definition.description,
                            value: result.status === 'available' ? result.value : null,
                            status: result.status,
                            unit: definition.unit,
                            metricVersion: definition.version,
                            evidenceVersion: evidence.evidenceVersion,
                            asOf: evidence.selectedAt,
                        }),
                    )
                } catch {
                    throw new PluginError(display.id, 'invalid_display_value')
                }
            }
            return {
                radar: radarScoresSchema.parse(Object.fromEntries(entries)),
                customMetrics,
                metricEvidence: Object.fromEntries(
                    [...values].map(([id, value]) => [id, value.metadata]),
                ),
                topicSupport,
            }
        },
    }
}
