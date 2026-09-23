/** 部署者可以在自己的组合入口注册公开文档；工作区默认不被索引。 */
export interface PublicPageRegistration {
    readonly path: string
    readonly titleKey: string
    readonly descriptionKey: string
    readonly document?: { readonly structuredDataType?: 'Article' | 'TechArticle' }
}

export function getPublicPage(_path: string): PublicPageRegistration | undefined {
    void _path
    return undefined
}

export function getPublicPageCanonical(_path: string): string | null {
    void _path
    return null
}
