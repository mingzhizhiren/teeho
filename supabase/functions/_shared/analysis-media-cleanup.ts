import { analysisMediaCleanupConstraints } from './analysis-media.constants.ts'

export interface AnalysisMediaCleanupCandidate {
    id: string
    originalObjectPath: string
    processedObjectPath: string | null
}

interface AnalysisMediaCleanupSummary {
    claimed: number
    deleted: number
    failed: number
    batches: number
}

interface AnalysisMediaCleanupDependencies {
    claim: (batchSize: number, leaseSeconds: number) => Promise<AnalysisMediaCleanupCandidate[]>
    remove: (paths: string[]) => Promise<void>
    complete: (assetId: string, succeeded: boolean, errorCode: string | null) => Promise<void>
}

/** 校验清理 RPC 返回的数据；对象路径只传给 Storage，不记录到日志。 */
export function parseCleanupCandidates(value: unknown): AnalysisMediaCleanupCandidate[] {
    if (!Array.isArray(value) || value.length > analysisMediaCleanupConstraints.batchSize) {
        throw new Error('cleanup_invalid_response')
    }
    return value.map((item: unknown) => {
        if (!item || typeof item !== 'object') throw new Error('cleanup_invalid_response')
        const row = item as Record<string, unknown>
        if (
            typeof row.id !== 'string' ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(row.id) ||
            !isObjectPath(row.original_object_path) ||
            (row.processed_object_path !== null && !isObjectPath(row.processed_object_path))
        ) {
            throw new Error('cleanup_invalid_response')
        }
        return {
            id: row.id,
            originalObjectPath: row.original_object_path,
            processedObjectPath: row.processed_object_path,
        }
    })
}

function isObjectPath(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        value.length > 0 &&
        value.length <= analysisMediaCleanupConstraints.maxPathLength &&
        !value.startsWith('/') &&
        !value.includes('\\') &&
        !value.includes('\0') &&
        !value.split('/').some((part) => part === '.' || part === '..')
    )
}

/** 协调可恢复的认领、Storage 删除和数据库回写。失败由租约与有限重试恢复。 */
export async function runAnalysisMediaCleanup(
    dependencies: AnalysisMediaCleanupDependencies,
): Promise<AnalysisMediaCleanupSummary> {
    let summary: AnalysisMediaCleanupSummary = { claimed: 0, deleted: 0, failed: 0, batches: 0 }
    for (let batch = 0; batch < analysisMediaCleanupConstraints.maxBatches; batch += 1) {
        const candidates = await dependencies.claim(
            analysisMediaCleanupConstraints.batchSize,
            analysisMediaCleanupConstraints.leaseSeconds,
        )
        summary = {
            ...summary,
            batches: summary.batches + 1,
            claimed: summary.claimed + candidates.length,
        }
        for (const candidate of candidates) {
            const paths = [candidate.originalObjectPath, candidate.processedObjectPath].filter(
                (path): path is string => path !== null,
            )
            try {
                await dependencies.remove([...new Set(paths)])
                await dependencies.complete(candidate.id, true, null)
                summary = { ...summary, deleted: summary.deleted + 1 }
            } catch {
                try {
                    await dependencies.complete(candidate.id, false, 'storage_delete_failed')
                } catch {
                    // 保留 deleting 状态，租约超时后重试；不记录路径或异常正文。
                    console.warn({ event: 'analysis_media_cleanup_completion_deferred' })
                }
                summary = { ...summary, failed: summary.failed + 1 }
            }
        }
        if (candidates.length < analysisMediaCleanupConstraints.batchSize) break
    }
    return summary
}
