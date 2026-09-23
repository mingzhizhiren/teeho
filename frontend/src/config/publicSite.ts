/** 自部署站点地址仅取当前来源；不指向官方运营服务。 */
export const publicSite = {
    canonicalUrl: typeof window === 'undefined' ? 'http://localhost:8080' : window.location.origin,
    operatorName: 'Jerry',
} as const
