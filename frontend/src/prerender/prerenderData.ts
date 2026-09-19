import type { InjectionKey } from 'vue'
import { z } from 'zod'

const minimumDocumentHeadingLevel = 2
const maximumDocumentHeadingLevel = 6
const documentHeadingSchema = z.object({
    id: z.string().min(1),
    text: z.string().min(1),
    level: z.number().int().min(minimumDocumentHeadingLevel).max(maximumDocumentHeadingLevel),
})
const publicDocumentSchema = z.object({
    requestedLocale: z.literal('zh-CN'),
    locale: z.literal('zh-CN'),
    category: z.enum(['legal', 'product', 'guides']),
    slug: z.enum([
        'terms',
        'privacy',
        'refund-policy',
        'insight-engine',
        'xiaohongshu-topic-evaluation',
    ]),
    meta: z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        version: z.string().optional(),
        updatedAt: z.string().optional(),
        icon: z.string().optional(),
    }),
    markdown: z.string(),
    etag: z.string().min(1),
})

export const prerenderDataSchema = z.object({
    document: z
        .object({
            value: publicDocumentSchema,
            body: z.object({
                html: z.string(),
                headings: z.array(documentHeadingSchema),
            }),
        })
        .optional(),
})

export type PrerenderData = z.infer<typeof prerenderDataSchema>

export const prerenderDataKey: InjectionKey<PrerenderData> = Symbol('teeho-prerender-data')
export const prerenderDataElementId = 'teeho-prerender-data'

/** 把预渲染载荷安全写入不可执行的 JSON script。 */
export function serializePrerenderData(data: PrerenderData) {
    return JSON.stringify(data).replace(/</gu, '\\u003c')
}

/** 从预渲染 HTML 读取并校验客户端水合载荷。 */
export function readPrerenderData(): PrerenderData {
    if (typeof document === 'undefined') return {}
    const source = document.getElementById(prerenderDataElementId)?.textContent
    if (!source) return {}

    try {
        const parsed = prerenderDataSchema.safeParse(JSON.parse(source) as unknown)
        return parsed.success ? parsed.data : {}
    } catch {
        return {}
    }
}
