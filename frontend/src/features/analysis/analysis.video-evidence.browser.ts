import { getAnalysisVideoEvidence } from '@/api/analysis'
import { createBrowserVideoEvidenceTransferClient } from './analysis.video-evidence.adapter'

/** 工作台使用的认证 API + 私有 Storage 视频证据传输客户端。 */
export const browserVideoEvidenceTransferClient = createBrowserVideoEvidenceTransferClient({
    getDownload: getAnalysisVideoEvidence,
    fetch: window.fetch.bind(window),
})
