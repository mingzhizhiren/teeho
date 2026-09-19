import type { VideoEvidenceDownloadBundle, VideoEvidenceTransferClient } from './localVideoEvidence'

interface BrowserVideoEvidenceTransferDependencies {
    getDownload: (videoId: string) => Promise<VideoEvidenceDownloadBundle>
    fetch: typeof fetch
}

/** 把认证业务 API 与短期 Supabase Storage URL 组合成浏览器证据传输端口。 */
export function createBrowserVideoEvidenceTransferClient(
    dependencies: BrowserVideoEvidenceTransferDependencies,
): VideoEvidenceTransferClient {
    return {
        getDownload: dependencies.getDownload,

        async fetchDownload(url) {
            const response = await dependencies.fetch(url)
            if (!response.ok) {
                throw new Error('视频证据下载失败')
            }
            return response.blob()
        },
    }
}
