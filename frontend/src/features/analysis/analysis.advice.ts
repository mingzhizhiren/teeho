import { z } from 'zod'

const ADVICE_LIMITS = { items: 5, sourceId: 80, evidence: 500, description: 800 } as const
const SOURCE_PATTERNS = {
    title: /^title$/u,
    body: /^body:p[1-9]\d*$/u,
    topics: /^topic:[1-9]\d*$/u,
    cover: /^material:cover$/u,
    content: /^material:content$/u,
} as const
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const

const adviceItemSchema = z
    .object({
        priority: z.enum(['high', 'medium', 'low']),
        location: z.enum(['title', 'body', 'topics', 'cover', 'content']),
        sourceId: z.string().max(ADVICE_LIMITS.sourceId),
        evidence: z.string().trim().min(1).max(ADVICE_LIMITS.evidence),
        problem: z.string().trim().min(1).max(ADVICE_LIMITS.description),
        suggestion: z.string().trim().min(1).max(ADVICE_LIMITS.description),
    })
    .strict()
    .refine(
        (item) => {
            if (!SOURCE_PATTERNS[item.location].test(item.sourceId)) return false
            const position = item.sourceId.match(/^(?:body:p|topic:)(\d+)$/u)?.[1]
            return !position || Number.isSafeInteger(Number(position))
        },
        {
            path: ['sourceId'],
            message: 'Advice location must match its source',
        },
    )

/** 新增建议独立校验，保持成功空结果与暂不可用的不同含义。 */
export const contentAdviceSchema = z.discriminatedUnion('status', [
    z
        .object({
            status: z.literal('completed'),
            evidenceAvailability: z.enum(['sufficient', 'limited']),
            items: z.array(adviceItemSchema).max(ADVICE_LIMITS.items),
        })
        .strict(),
    z.object({ status: z.literal('unavailable'), items: z.array(z.never()).length(0) }).strict(),
])

/** 已核验的建议报告，不包含素材内部身份或虚构时间位置。 */
export type ContentAdvice = z.infer<typeof contentAdviceSchema>
/** 一条有原文依据和修改方向的建议。 */
export type ContentAdviceItem = z.infer<typeof adviceItemSchema>

/** 网页和复制报告共用的本地化标签。 */
export interface ContentAdviceLabels {
    title: string
    empty: string
    unavailable: string
    problem: string
    location: string
    evidence: string
    suggestion: string
    priorities: Readonly<Record<ContentAdviceItem['priority'], string>>
    titleLocation: string
    coverLocation: string
    contentLocation: string
    paragraphLocation: (number: string) => string
    topicLocation: (number: string) => string
}

type AdviceTranslator = (key: string, values?: { number: string }) => string

/** 统一网页与复制的措辞，位置序号保持字符串避免不安全数值转换。 */
export function createContentAdviceLabels(t: AdviceTranslator): ContentAdviceLabels {
    const prefix = 'workspace.checkup.contentAnalysis.advice'
    return {
        title: t(`${prefix}.title`),
        empty: t('workspace.checkup.contentAnalysis.noObviousWeaknesses'),
        unavailable: t(`${prefix}.unavailable`),
        problem: t(`${prefix}.problem`),
        location: t(`${prefix}.location`),
        evidence: t(`${prefix}.evidence`),
        suggestion: t(`${prefix}.suggestion`),
        priorities: {
            high: t(`${prefix}.priorities.high`),
            medium: t(`${prefix}.priorities.medium`),
            low: t(`${prefix}.priorities.low`),
        },
        titleLocation: t('workspace.checkup.contentAnalysis.locations.title'),
        coverLocation: t('workspace.checkup.contentAnalysis.locations.cover'),
        contentLocation: t(`${prefix}.contentLocation`),
        paragraphLocation: (number) => t(`${prefix}.paragraphLocation`, { number }),
        topicLocation: (number) => t(`${prefix}.topicLocation`, { number }),
    }
}

/** 只排序副本，同级建议保持报告保存时的先后顺序。 */
export function orderedAdviceItems(advice: ContentAdvice): ContentAdviceItem[] {
    return advice.status === 'completed'
        ? [...advice.items].sort(
              (left, right) => PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority],
          )
        : []
}

/** 将受控来源转换为用户可核验的位置，不显示协议标识。 */
export function formatAdviceLocation(item: ContentAdviceItem, labels: ContentAdviceLabels): string {
    if (item.location === 'body')
        return labels.paragraphLocation(item.sourceId.replace(/^body:p/u, ''))
    if (item.location === 'topics')
        return labels.topicLocation(item.sourceId.replace(/^topic:/u, ''))
    if (item.location === 'cover') return labels.coverLocation
    return item.location === 'content' ? labels.contentLocation : labels.titleLocation
}

/** 复制所有已保存的建议字段，历史缺项保持缺项。 */
export function contentAdviceCopyLines(
    advice: ContentAdvice | undefined,
    labels: ContentAdviceLabels,
): string[] {
    if (!advice) return []
    if (advice.status === 'unavailable') return [labels.title, labels.unavailable]
    const items = orderedAdviceItems(advice)
    return [
        labels.title,
        ...(items.length
            ? items.map((item) =>
                  [
                      `[${labels.priorities[item.priority]}] ${labels.problem}: ${item.problem}`,
                      `${labels.location}: ${formatAdviceLocation(item, labels)}`,
                      `${labels.evidence}: ${item.evidence}`,
                      `${labels.suggestion}: ${item.suggestion}`,
                  ].join('\n'),
              )
            : [labels.empty]),
    ]
}
