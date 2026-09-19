import { BlockList, isIP } from 'node:net'

import { z } from 'zod'

import { analysisWebResearchConstraints } from '../analysis.constants'
import type { StandardAnalysisTask } from '../analysis.schema'
import { analysisTrackCatalog } from '../tracks/analysis.tracks'

const blockedIpv4Cidrs = [
    '0.0.0.0/8',
    '10.0.0.0/8',
    '100.64.0.0/10',
    '127.0.0.0/8',
    '169.254.0.0/16',
    '172.16.0.0/12',
    '192.0.0.0/24',
    '192.0.2.0/24',
    '192.88.99.0/24',
    '192.168.0.0/16',
    '198.18.0.0/15',
    '198.51.100.0/24',
    '203.0.113.0/24',
    '224.0.0.0/4',
    '240.0.0.0/4',
] as const
const blockedIpv6Cidrs = [
    '2001::/23',
    '2001:db8::/32',
    '2002::/16',
    '2620:4f:8000::/48',
    '3fff::/20',
] as const
const allocatedPublicIpv6Cidrs = [
    '2001::/23',
    '2001:200::/23',
    '2001:400::/23',
    '2001:600::/23',
    '2001:800::/22',
    '2001:c00::/23',
    '2001:e00::/23',
    '2001:1200::/23',
    '2001:1400::/22',
    '2001:1800::/23',
    '2001:1a00::/23',
    '2001:1c00::/22',
    '2001:2000::/19',
    '2001:4000::/23',
    '2001:4200::/23',
    '2001:4400::/23',
    '2001:4600::/23',
    '2001:4800::/23',
    '2001:4a00::/23',
    '2001:4c00::/23',
    '2001:5000::/20',
    '2001:8000::/19',
    '2001:a000::/20',
    '2001:b000::/20',
    '2002::/16',
    '2003::/18',
    '2400::/12',
    '2410::/12',
    '2600::/12',
    '2610::/23',
    '2620::/23',
    '2630::/12',
    '2800::/12',
    '2a00::/12',
    '2a10::/12',
    '2c00::/12',
] as const
const ipv4OctetBase = 256
const binaryBase = 2
const ipv4BitCount = 32
const publicIpv6FirstWordMinimum = 0x2000
const publicIpv6FirstWordMaximum = 0x3fff
const ipv4Version = 4
const ipv6Version = 6
const blockedIpv6Addresses = new BlockList()
const allocatedPublicIpv6Addresses = new BlockList()

for (const cidr of blockedIpv6Cidrs) {
    const [network = '', prefixText = ''] = cidr.split('/')
    blockedIpv6Addresses.addSubnet(network, Number(prefixText), 'ipv6')
}
for (const cidr of allocatedPublicIpv6Cidrs) {
    const [network = '', prefixText = ''] = cidr.split('/')
    allocatedPublicIpv6Addresses.addSubnet(network, Number(prefixText), 'ipv6')
}

function ipv4Number(value: string) {
    return value
        .split('.')
        .map(Number)
        .reduce((result, octet) => result * ipv4OctetBase + octet, 0)
}

function isPublicIpv4(value: string) {
    const address = ipv4Number(value)
    return !blockedIpv4Cidrs.some((cidr) => {
        const [network = '', prefixText = ''] = cidr.split('/')
        const prefix = Number(prefixText)
        const blockSize = binaryBase ** (ipv4BitCount - prefix)
        return Math.floor(address / blockSize) === Math.floor(ipv4Number(network) / blockSize)
    })
}

function isPublicIpv6(value: string) {
    const firstWord = Number.parseInt(value.split(':', 1)[0] ?? '', 16)
    if (
        !Number.isInteger(firstWord) ||
        firstWord < publicIpv6FirstWordMinimum ||
        firstWord > publicIpv6FirstWordMaximum
    ) {
        return false
    }
    return (
        allocatedPublicIpv6Addresses.check(value, 'ipv6') &&
        !blockedIpv6Addresses.check(value, 'ipv6')
    )
}

/** 判断地址是否为无需认证且不指向本机、保留或私有网段的公开 HTTPS 页面。 */
export function isPublicWebResearchUrl(value: string) {
    try {
        const parsed = new URL(value)
        const hostname = parsed.hostname.toLocaleLowerCase().replace(/^\[|\]$/gu, '')
        const ipVersion = isIP(hostname)
        return (
            parsed.protocol === 'https:' &&
            !parsed.username &&
            !parsed.password &&
            hostname !== 'localhost' &&
            !hostname.endsWith('.localhost') &&
            !hostname.endsWith('.local') &&
            !hostname.endsWith('.internal') &&
            hostname !== 'home.arpa' &&
            !hostname.endsWith('.home.arpa') &&
            (ipVersion === 0 ||
                (ipVersion === ipv4Version && isPublicIpv4(hostname)) ||
                (ipVersion === ipv6Version && isPublicIpv6(hostname)))
        )
    } catch {
        return false
    }
}

const safeHttpsUrlSchema = z
    .string()
    .url()
    .refine(isPublicWebResearchUrl, '参考资料必须使用不含认证信息且不指向私有网络的 HTTPS 地址')

/** 结果页可安全展示的实际采用来源字段。 */
export const analysisWebResearchPublicSourceSchema = z
    .object({
        title: z.string().trim().min(1).max(analysisWebResearchConstraints.sourceTitleMaxLength),
        site: z.string().trim().min(1).max(analysisWebResearchConstraints.sourceSiteMaxLength),
        publishedAt: z.string().datetime({ offset: true }).nullable(),
        url: safeHttpsUrlSchema,
    })
    .strict()

const webResearchSourceTypeSchema = z.enum([
    'official',
    'government',
    'brand',
    'academic',
    'authoritative_media',
    'industry_report',
    'community',
])

const isoDateTimeWithoutOffsetPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/u
const webResearchPublishedAtSchema = z
    .preprocess(
        (value) =>
            typeof value === 'string' && isoDateTimeWithoutOffsetPattern.test(value)
                ? `${value}Z`
                : value,
        z.string().datetime({ offset: true }),
    )
    .transform((value) => new Date(value).toISOString())

/** 后端快照采用的来源，额外保存质量分类且拒绝无法确认日期的资料。 */
export const analysisWebResearchSourceSchema = analysisWebResearchPublicSourceSchema
    .extend({
        publishedAt: webResearchPublishedAtSchema,
        sourceType: webResearchSourceTypeSchema,
    })
    .strict()

const webResearchFactSchema = z
    .object({
        text: z.string().trim().min(1).max(analysisWebResearchConstraints.factMaxLength),
        sourceUrls: z
            .array(safeHttpsUrlSchema)
            .min(1)
            .max(analysisWebResearchConstraints.maxSources),
    })
    .strict()

const webResearchConflictSchema = z
    .object({
        draftClaim: z.string().trim().min(1).max(analysisWebResearchConstraints.factMaxLength),
        externalFinding: z.string().trim().min(1).max(analysisWebResearchConstraints.factMaxLength),
        sourceUrls: z
            .array(safeHttpsUrlSchema)
            .min(1)
            .max(analysisWebResearchConstraints.maxSources),
    })
    .strict()

const collectedWebResearchResultObjectSchema = z
    .object({
        status: z.literal('collected'),
        summary: z.string().trim().min(1).max(analysisWebResearchConstraints.summaryMaxLength),
        keyFacts: z.array(webResearchFactSchema).max(analysisWebResearchConstraints.maxFacts),
        conflicts: z
            .array(webResearchConflictSchema)
            .max(analysisWebResearchConstraints.maxConflicts),
        sources: z
            .array(analysisWebResearchSourceSchema)
            .min(1)
            .max(analysisWebResearchConstraints.maxSources),
    })
    .strict()

const noSourcesWebResearchResultObjectSchema = z
    .object({
        status: z.literal('no_sources'),
        summary: z.null(),
        keyFacts: z.array(z.never()).max(0),
        conflicts: z.array(z.never()).max(0),
        sources: z.array(z.never()).max(0),
    })
    .strict()

/** Codex 联网调用必须返回的严格结构。 */
const primarySourceTypes = new Set(['official', 'government', 'brand', 'academic'])
const collectedEvidenceMessages = {
    unadopted: '事实引用必须来自实际采用来源',
    communityOnly: '社区内容不能独立承担关键事实',
    insufficientIndependent: '缺少一手来源的关键事实需要两个独立可靠来源',
} as const

type CollectedWebResearchResult = z.infer<typeof collectedWebResearchResultObjectSchema>

function collectedClaimIssue(
    urls: string[],
    sources: ReadonlyMap<string, CollectedWebResearchResult['sources'][number]>,
): string | null {
    const claimSources = urls
        .map((url) => sources.get(url))
        .filter((source): source is NonNullable<typeof source> => Boolean(source))
    if (claimSources.length !== urls.length) {
        return collectedEvidenceMessages.unadopted
    }
    if (claimSources.every((source) => source.sourceType === 'community')) {
        return collectedEvidenceMessages.communityOnly
    }
    if (claimSources.some((source) => primarySourceTypes.has(source.sourceType))) {
        return null
    }
    const independentHosts = new Set(
        claimSources
            .filter((source) => source.sourceType !== 'community')
            .map((source) => new URL(source.url).hostname),
    )
    return independentHosts.size >= analysisWebResearchConstraints.minimumIndependentSources
        ? null
        : collectedEvidenceMessages.insufficientIndependent
}

function sanitizeCollectedResearchEvidence(
    result: CollectedWebResearchResult,
): CollectedWebResearchResult {
    const sources = new Map(result.sources.map((source) => [source.url, source]))
    return {
        ...result,
        keyFacts: result.keyFacts.filter(
            (fact) => collectedClaimIssue(fact.sourceUrls, sources) === null,
        ),
        conflicts: result.conflicts.filter(
            (conflict) => collectedClaimIssue(conflict.sourceUrls, sources) === null,
        ),
    }
}

/** 校验事实只引用实际采用来源，且社区观察不能独立承担关键事实。 */
function validateCollectedResearchEvidence(
    result: CollectedWebResearchResult,
    context: z.RefinementCtx,
) {
    const sources = new Map(result.sources.map((source) => [source.url, source]))
    const claims = [
        ...result.keyFacts.map((fact) => ({ urls: fact.sourceUrls, path: ['keyFacts'] })),
        ...result.conflicts.map((conflict) => ({
            urls: conflict.sourceUrls,
            path: ['conflicts'],
        })),
    ]
    for (const claim of claims) {
        const message = collectedClaimIssue(claim.urls, sources)
        if (message) {
            context.addIssue({ code: z.ZodIssueCode.custom, path: claim.path, message })
        }
    }
}

/** Codex 联网调用必须返回的严格结构。 */
const webResearchResultObjectSchema = z.discriminatedUnion('status', [
    collectedWebResearchResultObjectSchema,
    noSourcesWebResearchResultObjectSchema,
])

export const webResearchResultSchema = webResearchResultObjectSchema.superRefine(
    (result, context) => {
        if (result.status === 'collected') {
            validateCollectedResearchEvidence(result, context)
        }
    },
)

const webResearchSnapshotMetadataShape = {
    schemaVersion: z.literal(analysisWebResearchConstraints.snapshotVersion),
    generationVersion: z.number().int().positive(),
    sourceTime: z.string().datetime({ offset: true }),
    queryVersion: z.literal(analysisWebResearchConstraints.queryVersion),
    snapshotVersion: z.literal(analysisWebResearchConstraints.snapshotVersion),
}

/** 后端冻结的一次完整生成联网资料快照。 */
export const webResearchSnapshotSchema = z
    .discriminatedUnion('status', [
        collectedWebResearchResultObjectSchema.extend(webResearchSnapshotMetadataShape).strict(),
        noSourcesWebResearchResultObjectSchema.extend(webResearchSnapshotMetadataShape).strict(),
    ])
    .superRefine((snapshot, context) => {
        if (snapshot.status === 'collected') {
            validateCollectedResearchEvidence(snapshot, context)
        }
    })

export type AnalysisWebResearchResult = z.infer<typeof webResearchResultSchema>
export type AnalysisWebResearchSnapshot = z.infer<typeof webResearchSnapshotSchema>
export type AnalysisWebResearchSource = z.infer<typeof analysisWebResearchSourceSchema>
export type AnalysisWebResearchPublicSource = z.infer<typeof analysisWebResearchPublicSourceSchema>

/** Codex 理解联网目标所需的已确认字段；不含素材、账号或内部任务身份。 */
export interface AnalysisWebResearchInput {
    topic: string | null
    trackName: string | null
    accountPositioning: string | null
    targetAudience: string | null
    brandFacts: string | null
}

/** 搜索工具唯一允许接收的脱敏短查询计划。 */
export interface AnalysisWebResearchQueryPlan {
    schemaVersion: 'web-research-query-plan.v1'
    queries: string[]
}

const privateTextPatterns = [
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu,
    /(?:\+?86[-\s]?)?1[3-9]\d{9}/gu,
    /(?:订单(?:号)?|账号|账户|用户\s*ID|order\s*id)\s*[:：#]?\s*[A-Z0-9_-]{5,}/giu,
    /(?:收货地址|详细地址|家庭住址|住址|地址)\s*[:：]?\s*[^\n,，。;；]{4,80}/giu,
]

/** 移除不得发送给公开搜索服务的常见个人与账号标识。 */
export function redactWebResearchQueryText(value: string) {
    return privateTextPatterns.reduce((redacted, pattern) => redacted.replace(pattern, ' '), value)
}

/** 查询可自由改写，但不得包含会被脱敏规则移除的私密标识。 */
export function isSafeWebResearchQuery(value: string): boolean {
    return Boolean(value.trim()) && redactWebResearchQueryText(value) === value
}

function normalizeQueryPart(value: string | null | undefined) {
    if (!value) {
        return ''
    }
    return redactWebResearchQueryText(value)
        .replace(/[#\p{P}\p{S}]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
}

function shortResearchPart(value: string | null) {
    const normalized = normalizeQueryPart(value)
    if (normalized.length < analysisWebResearchConstraints.minimumSemanticQueryLength) {
        return ''
    }
    const maximum = Math.min(
        analysisWebResearchConstraints.bodyKeywordMaxLength,
        Math.max(0, normalized.length - 1),
    )
    return normalized.slice(0, maximum).trim()
}

function createBoundedQuery(parts: string[]) {
    const query = parts
        .filter((part) => part.length >= analysisWebResearchConstraints.minimumSemanticQueryLength)
        .join(' ')
        .replace(/\s+/gu, ' ')
        .trim()
    return query.slice(0, analysisWebResearchConstraints.queryMaxLength).trim()
}

/** 由五项允许字段确定最多两条短查询；其他共享草稿内容永不进入查询。 */
export function createWebResearchQueryPlan(
    input: AnalysisWebResearchInput,
): AnalysisWebResearchQueryPlan {
    const topic = normalizeQueryPart(input.topic)
    const track = normalizeQueryPart(input.trackName)
    const positioning = shortResearchPart(input.accountPositioning)
    const audience = shortResearchPart(input.targetAudience)
    const brandFacts = shortResearchPart(input.brandFacts)
    const candidates = [
        createBoundedQuery([topic, track, positioning, audience, '近期资料']),
        createBoundedQuery([topic, track, brandFacts, '官方资料']),
    ]
    const queries = [...new Set(candidates)].filter((query) => {
        const semantic = query.replace(/近期资料|官方资料|\s/gu, '')
        return semantic.length >= analysisWebResearchConstraints.minimumSemanticQueryLength
    })
    return { schemaVersion: 'web-research-query-plan.v1', queries }
}

/** 将内部来源质量字段收缩为结果页最小安全来源。 */
export function toPublicWebResearchSources(
    sources: AnalysisWebResearchSource[],
): AnalysisWebResearchPublicSource[] {
    return sources.map(({ title, site, publishedAt, url }) => ({
        title,
        site,
        publishedAt,
        url,
    }))
}

function searchableFieldValue(
    field: StandardAnalysisTask['fields'][keyof StandardAnalysisTask['fields']],
): string | null {
    if (!['user_input', 'agent_inference'].includes(field.source)) {
        return null
    }
    return typeof field.value === 'string' && field.value.trim() ? field.value.trim() : null
}

function webResearchTrackName(task: StandardAnalysisTask): string | null {
    if (!['user_input', 'agent_inference'].includes(task.fields.track.source)) {
        return null
    }
    if (task.fields.track.value === 'custom') {
        return searchableFieldValue(task.fields.customTrackName)
    }
    const track = analysisTrackCatalog.find((candidate) => candidate.id === task.fields.track.value)
    return track?.keywords[0] ?? task.fields.track.value.replaceAll('_', ' ')
}

/** 从用户已确认的不可变任务中只投影五类允许联网字段。 */
export function createWebResearchInput(task: StandardAnalysisTask): AnalysisWebResearchInput {
    return {
        topic: searchableFieldValue(task.fields.title),
        trackName: webResearchTrackName(task),
        accountPositioning: searchableFieldValue({ value: null, source: 'system_default' }),
        targetAudience: searchableFieldValue({ value: null, source: 'system_default' }),
        brandFacts: searchableFieldValue({ value: null, source: 'system_default' }),
    }
}

/** 拒绝任何额外 Provider 字段，避免网页原文或内部诊断进入快照。 */
export function readWebResearchResult(value: unknown): AnalysisWebResearchResult {
    const result = webResearchResultObjectSchema.parse(value)
    return webResearchResultSchema.parse(
        result.status === 'collected' ? sanitizeCollectedResearchEvidence(result) : result,
    )
}
