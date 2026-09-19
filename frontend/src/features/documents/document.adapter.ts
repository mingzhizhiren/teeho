import {
    getPublicDocument,
    type PublicDocument,
    type PublicDocumentCategory,
    type PublicDocumentLocale,
    type PublicDocumentSlug,
} from '@/api/documents'

/** 文档页面使用的 HTTP 边界。 */
export const documentAdapter = {
    getPublicDocument,
}

export type {
    PublicDocument,
    PublicDocumentCategory,
    PublicDocumentLocale,
    PublicDocumentSlug,
}
