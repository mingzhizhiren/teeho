/** 创建允许页面卸载后继续传输的尽力而为请求 Adapter。 */
export function createBestEffortRequest(
    fetcher: typeof fetch,
    baseUrl: string,
): (path: string, method: 'DELETE' | 'POST') => Promise<Response> {
    const normalizedBaseUrl = baseUrl.replace(/\/$/u, '')
    return (path, method) => {
        const requestPath = path.startsWith('/') ? path : `/${path}`
        return fetcher(`${normalizedBaseUrl}${requestPath}`, {
            method,
            credentials: 'include',
            keepalive: true,
        })
    }
}
