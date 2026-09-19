import { VIDEO_RULES } from '../config/constants'

/** 待清理的视频证据候选项。 */
export interface VideoEvidenceCleanupCandidate {
    evidenceId: string
    objectPaths: string[]
}

/** 执行视频证据清理所需的依赖。 */
export interface VideoEvidenceCleanupDependencies {
    claim: () => Promise<VideoEvidenceCleanupCandidate | null>
    remove: (paths: string[]) => Promise<void>
    complete: (evidenceId: string) => Promise<boolean>
    fail: (evidenceId: string, errorCode: string) => Promise<boolean>
}

/** 可恢复地逐项清理到期视频证据；单项失败不会阻塞同批其他证据。 */
export async function runVideoEvidenceCleanup(dependencies: VideoEvidenceCleanupDependencies) {
    const summary = { claimed: 0, deleted: 0, failed: 0 }
    while (summary.claimed < VIDEO_RULES.maximumEvidenceCleanupItemsPerSweep) {
        const candidate = await dependencies.claim()
        if (!candidate) {
            break
        }
        summary.claimed += 1
        try {
            await dependencies.remove([...new Set(candidate.objectPaths)])
            if (await dependencies.complete(candidate.evidenceId)) {
                summary.deleted += 1
            } else {
                summary.failed += 1
            }
        } catch {
            try {
                await dependencies.fail(
                    candidate.evidenceId,
                    'video_evidence_storage_delete_failed',
                )
            } finally {
                summary.failed += 1
            }
        }
    }
    return summary
}
