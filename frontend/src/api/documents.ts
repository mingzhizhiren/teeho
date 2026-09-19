import { request, type ApiResponse } from '@/utils/request'

/** 公开文档支持的界面语言。 */
export type PublicDocumentLocale = 'zh-CN' | 'en-US'
/** 公开 Markdown 内容的稳定分类。 */
export type PublicDocumentCategory = 'legal' | 'product' | 'guides'
/** 公开文档使用的稳定路由标识。 */
export type PublicDocumentSlug =
    | 'terms'
    | 'privacy'
    | 'refund-policy'
    | 'insight-engine'
    | 'xiaohongshu-topic-evaluation'

/** 允许由公开文档 frontmatter 提供的展示元数据。 */
export interface PublicDocumentMeta {
    title?: string
    description?: string
    version?: string
    updatedAt?: string
    icon?: string
}

/** 匿名文档 API 返回的 Markdown 文档契约。 */
export interface PublicDocument {
    requestedLocale: PublicDocumentLocale
    locale: PublicDocumentLocale
    category: PublicDocumentCategory
    slug: PublicDocumentSlug
    meta: PublicDocumentMeta
    markdown: string
    etag: string
}

/** GET `/api/docs/:locale/:category/:slug`：匿名读取注册的 Markdown 文档。 */
export function getPublicDocument(
    locale: PublicDocumentLocale,
    category: PublicDocumentCategory,
    slug: PublicDocumentSlug,
) {
    return request.get<ApiResponse<{ document: PublicDocument }>>(
        `/docs/${locale}/${category}/${slug}`,
    )
}
