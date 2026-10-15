import { getAnalysisVideoEvidence } from '@/api/analysis'
import { createBrowserVideoEvidenceTransferClient } from './analysis.video-evidence.adapter'
import type { StandardAnalysisTask } from './analysis.contract'
import {
    LocalVideoEvidenceError,
    LocalVideoEvidenceManager,
    preserveVideoEvidenceLocally,
} from './localVideoEvidence'
import { estimateBrowserStorageCapacity } from './storageCapacity'

/** 工作台使用的认证 API + 私有 Storage 视频证据传输客户端。 */
export const browserVideoEvidenceTransferClient = createBrowserVideoEvidenceTransferClient({
    getDownload: getAnalysisVideoEvidence,
    fetch: window.fetch.bind(window),
})

/** 正式任务取得视频证据后才补存关键帧；上传与任务提交不等待下载。 */
export async function preserveAnalysisTaskVideoEvidence(
    evidence: NonNullable<StandardAnalysisTask['videoEvidence']>,
    ownerUserId: string,
    isCurrent: () => boolean,
): Promise<void> {
    const manager = new LocalVideoEvidenceManager(ownerUserId)
    let hasEvidence = false
    try {
        hasEvidence = Boolean(await manager.get(evidence.evidenceId))
    } catch {
        // 本地副本损坏时仍用有效云端证据修复，不能静默宣称已保存。
    }
    if (!isCurrent() || hasEvidence) return
    const preservation = await preserveVideoEvidenceLocally(
        evidence.assetId,
        manager,
        browserVideoEvidenceTransferClient,
        { estimateCapacity: estimateBrowserStorageCapacity },
    )
    if (preservation.kind === 'storage_warning') throw new LocalVideoEvidenceError('write_failed')
}
