import { withTransaction, type DatabaseTransaction } from '../../db/database'
import { lockAccountOperations } from '../../account/account-operation.lock'
import { TIME_MS } from '../../config/constants'
import { findReadyVideoEvidence } from '../../video/video.repository'
import { getTaskPolicy } from '../../runtime/task-policy'
import { logger } from '../../utils/logger'
import { createAnalysisFingerprints } from '../analysis.fingerprints'
import { standardAnalysisTaskSchema } from '../analysis.schema'
import { lockAnalysisTaskAccount } from './analysis.task.repository'
import {
    completeMediaPreparation,
    deferPreparationCheck,
    failMediaPreparation,
    listPreparingTasks,
    lockPreparingTask,
    readPreparationMedia,
} from './analysis.media-preparation.repository'

const PREPARATION_TIMEOUT_MINUTES = 15
/** 素材准备使用独立预算，期间不占用正式分析重试和执行时间。 */
export const MEDIA_PREPARATION = {
    timeoutMs: PREPARATION_TIMEOUT_MINUTES * TIME_MS.MINUTE,
    batchSize: 32,
    pollSeconds: 2,
} as const

interface PreparationResult {
    code: 'ready' | 'media_preparation_failed' | 'media_preparation_timeout'
    waitedMs: number
}

async function advancePreparation(
    transaction: DatabaseTransaction,
    candidate: { id: string; userId: string },
): Promise<PreparationResult | null> {
    await lockAccountOperations(transaction, candidate.userId)
    await lockAnalysisTaskAccount(transaction, candidate.userId)
    const row = await lockPreparingTask(transaction, candidate.id, candidate.userId)
    if (!row) return null
    const task = standardAnalysisTaskSchema.parse(row.standardTask)
    const waitedMs = Date.now() - new Date(row.createdAt).getTime()
    const expired = Date.parse(task.mediaPreparation!.deadlineAt) <= Date.now()
    const media = expired ? null : await readPreparationMedia(transaction, row.userId, task)
    const invalidVideo =
        media?.kind === 'ready' &&
        media.videoEvidence &&
        !(await findReadyVideoEvidence(transaction, row.userId, media.videoEvidence.assetId))
    if (expired || media?.kind === 'failed' || invalidVideo) {
        const code = expired ? 'media_preparation_timeout' : 'media_preparation_failed'
        await failMediaPreparation(transaction, row.id, code)
        await getTaskPolicy().release(transaction, row.userId, row.id)
        return { code, waitedMs }
    }
    if (media?.kind !== 'ready') {
        await deferPreparationCheck(transaction, row.id, MEDIA_PREPARATION.pollSeconds)
        return null
    }
    const { mediaPreparation: omitted, ...snapshot } = task
    void omitted
    const ready = standardAnalysisTaskSchema.parse({
        ...snapshot,
        videoEvidence: media.videoEvidence,
    })
    const fingerprints = createAnalysisFingerprints(ready, [
        ...media.imageDigests,
        ...(media.videoEvidence ? [media.videoEvidence.originalSha256] : []),
    ])
    await completeMediaPreparation(transaction, row.id, ready, fingerprints)
    return { code: 'ready', waitedMs }
}

/** 一次轮询只执行短数据库事务，不占用模型并发，也不依赖页面会话。 */
export async function advanceAnalysisMediaPreparations(): Promise<void> {
    const candidates = await listPreparingTasks(MEDIA_PREPARATION.batchSize)
    for (const candidate of candidates) {
        try {
            const outcome = await withTransaction((transaction) =>
                advancePreparation(transaction, candidate),
            )
            if (outcome)
                logger.info(
                    {
                        event: 'analysis_media_preparation_finished',
                        taskId: candidate.id,
                        ...outcome,
                    },
                    '素材准备阶段结束',
                )
        } catch (error: unknown) {
            logger.error(
                {
                    event: 'analysis_media_preparation_check_failed',
                    taskId: candidate.id,
                    errorName: error instanceof Error ? error.name : 'UnknownError',
                },
                '素材准备检查失败，将由后台重试',
            )
        }
    }
}
