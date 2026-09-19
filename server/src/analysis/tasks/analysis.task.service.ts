import { lockAccountOperations } from '../../account/account-operation.lock'
import { withTransaction, type DatabaseExecutor } from '../../db/database'
import { getTaskPolicy } from '../../runtime/task-policy'
import { assertVideoEvidenceSnapshotAvailable } from '../../video/video.analysis-evidence'
import {
    AnalysisAssetExpiredError,
    AnalysisQueueCapacityError,
    AnalysisSubmissionConflictError,
} from '../analysis.errors'
import type { AnalysisFingerprints } from '../analysis.fingerprints'
import {
    createAnalysisGenerationFingerprint,
    createAnalysisRecheckFingerprint,
} from '../analysis.fingerprints'
import type { AnalysisInputMode, StandardAnalysisTask } from '../analysis.schema'
import { standardAnalysisTaskSchema } from '../analysis.schema'
import {
    AnalysisConversationStaleError,
    resetAnalysisConversationAfterTaskAdmission,
    submitAnalysisConversationAfterTaskAdmission,
    type AnalysisConversationSessionIdentity,
} from '../conversation/analysis.conversation.repository'
import { clearAnalysisDraftSendWindow } from '../conversation/analysis.draft-send-window.repository'
import { requiredAnalysisImageReferences } from '../media/analysis.media-input'
import {
    bindReadyMediaAssets,
    countReadyMediaAssetsForReferences,
    requestMediaAssetCleanup,
    reuseReadyMediaAssetsForCheckup,
} from '../media/analysis.media.repository'
import {
    countActiveAnalysisTasks,
    abandonActiveAnalysisTask as persistAbandonedAnalysisTask,
    requeueFailedAnalysisTask,
} from './analysis.queue.repository'
import {
    findAnalysisTaskSubmission,
    findFailedAnalysisTask,
    findReanalyzableAnalysisTask,
    insertResearchingAnalysisTask,
    lockAnalysisTaskAccount,
} from './analysis.task.repository'

const queueCapacity = 1
const firstResultVersion = 1

/** 校验账号当前是否仍有任务队列容量 */
async function assertAnalysisQueueCapacity(executor: DatabaseExecutor, userId: string) {
    if ((await countActiveAnalysisTasks(executor, userId)) >= queueCapacity) {
        throw new AnalysisQueueCapacityError()
    }
}

/** 校验任务关联图片素材是否仍然可用 */
async function assertAnalysisAssetsAvailable(
    executor: DatabaseExecutor,
    userId: string,
    imageReferences: readonly string[],
    expiredMessage?: string,
) {
    if (imageReferences.length === 0) {
        return
    }
    const assetCount = await countReadyMediaAssetsForReferences(executor, userId, imageReferences)
    if (assetCount !== imageReferences.length) {
        throw new AnalysisAssetExpiredError(expiredMessage)
    }
}

/** 校验视频快照仍引用当前账号同一份受支持证据。 */
async function assertAnalysisVideoEvidenceAvailable(
    executor: DatabaseExecutor,
    userId: string,
    standardTask: StandardAnalysisTask,
) {
    if (standardTask.contentKind !== 'video') {
        return
    }
    if (!standardTask.videoEvidence) {
        throw new AnalysisAssetExpiredError('视频任务缺少证据引用')
    }
    await assertVideoEvidenceSnapshotAvailable(executor, userId, standardTask.videoEvidence)
}

/** 创建分析任务所需的应用参数。 */
export interface CreateAnalysisTaskParam {
    taskId: string
    userId: string
    inputMode: AnalysisInputMode
    inputFingerprint: string
    fingerprints: AnalysisFingerprints
    standardTask: StandardAnalysisTask
    assetIds: string[]
    session?: AnalysisConversationSessionIdentity | null
}

async function finalizeTaskAdmission(
    executor: DatabaseExecutor,
    userId: string,
    session?: AnalysisConversationSessionIdentity | null,
) {
    if (session) {
        const submitted = await submitAnalysisConversationAfterTaskAdmission(
            { userId, ...session },
            executor,
        )
        if (!submitted) throw new AnalysisConversationStaleError()
    } else {
        await resetAnalysisConversationAfterTaskAdmission(userId, executor)
    }
    await clearAnalysisDraftSendWindow(executor, userId)
}

/** 幂等创建任务，并在账号锁内执行活动任务和容量检查。 */
export function createResearchingAnalysisTask(param: CreateAnalysisTaskParam): Promise<string> {
    return withTransaction(async (transaction) => {
        await getTaskPolicy().assertAvailable(transaction)
        await lockAccountOperations(transaction, param.userId)
        await lockAnalysisTaskAccount(transaction, param.userId)
        const existing = await findAnalysisTaskSubmission(transaction, param.taskId, param.userId)
        if (existing) {
            if (existing.inputFingerprint !== param.inputFingerprint) {
                throw new AnalysisSubmissionConflictError()
            }
            await clearAnalysisDraftSendWindow(transaction, param.userId)
            return existing.id
        }

        await assertAnalysisVideoEvidenceAvailable(transaction, param.userId, param.standardTask)

        await assertAnalysisQueueCapacity(transaction, param.userId)

        const admissionPolicy = await getTaskPolicy().authorize(
            transaction,
            param.userId,
            param.standardTask,
        )

        const taskId = await insertResearchingAnalysisTask(transaction, {
            ...param,
            standardTask: {
                ...param.standardTask,
                publishedAt: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(
                    new Date(),
                ),
            },
            fingerprints: param.fingerprints,
            webResearchEnabled: admissionPolicy.webResearchEnabled,
        })
        await getTaskPolicy().reserve(
            transaction,
            param.userId,
            taskId,
            firstResultVersion,
            param.standardTask,
        )
        await bindReadyMediaAssets(transaction, taskId, param.userId, param.assetIds)
        await finalizeTaskAdmission(transaction, param.userId, param.session)
        return taskId
    })
}

/** 放弃资料搜集、排队或执行中的任务并立即删除临时图片。 */
export function abandonActiveAnalysisTask(taskId: string, userId: string) {
    return withTransaction(async (transaction) => {
        await lockAnalysisTaskAccount(transaction, userId)
        const abandoned = await persistAbandonedAnalysisTask(transaction, taskId, userId)
        if (!abandoned) {
            return false
        }
        await getTaskPolicy().release(transaction, userId, taskId)
        await requestMediaAssetCleanup(transaction, taskId, userId)
        return true
    })
}

/** 基于成功快照创建全新任务，并强制重新联网、读数和量化。 */
export function createReanalysisTask(
    sourceTaskId: string,
    newTaskId: string,
    userId: string,
): Promise<string | null> {
    const inputFingerprint = createAnalysisRecheckFingerprint(sourceTaskId, userId)
    return withTransaction(async (transaction) => {
        await getTaskPolicy().assertAvailable(transaction)
        await lockAccountOperations(transaction, userId)
        await lockAnalysisTaskAccount(transaction, userId)
        const existing = await findAnalysisTaskSubmission(transaction, newTaskId, userId)
        if (existing) {
            if (existing.inputFingerprint !== inputFingerprint)
                throw new AnalysisSubmissionConflictError()
            return existing.id
        }
        await assertAnalysisQueueCapacity(transaction, userId)
        const source = await findReanalyzableAnalysisTask(transaction, sourceTaskId, userId)
        if (!source) return null
        await assertAnalysisAssetsAvailable(
            transaction,
            userId,
            requiredAnalysisImageReferences(source.standardTask),
        )
        await assertAnalysisVideoEvidenceAvailable(transaction, userId, source.standardTask)
        const standardTask = standardAnalysisTaskSchema.parse({
            ...source.standardTask,
            publishedAt: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(
                new Date(),
            ),
        })
        const admissionPolicy = await getTaskPolicy().authorize(transaction, userId, standardTask)
        const fingerprints = {
            ...source.fingerprints,
            generation: createAnalysisGenerationFingerprint(
                standardTask,
                source.fingerprints.level,
            ),
        }
        const taskId = await insertResearchingAnalysisTask(transaction, {
            taskId: newTaskId,
            userId,
            inputMode: source.inputMode,
            inputFingerprint,
            fingerprints,
            standardTask,
            webResearchEnabled: admissionPolicy.webResearchEnabled,
        })
        await getTaskPolicy().reserve(transaction, userId, taskId, firstResultVersion, standardTask)
        await reuseReadyMediaAssetsForCheckup(
            transaction,
            taskId,
            userId,
            requiredAnalysisImageReferences(standardTask),
        )
        return taskId
    })
}

/** 人工重新排队最终技术失败的同一任务。 */
export function retryFailedAnalysisTask(taskId: string, userId: string) {
    return withTransaction(async (transaction) => {
        await getTaskPolicy().assertAvailable(transaction)
        await lockAccountOperations(transaction, userId)
        await lockAnalysisTaskAccount(transaction, userId)
        await assertAnalysisQueueCapacity(transaction, userId)

        const failedTask = await findFailedAnalysisTask(transaction, taskId, userId)
        if (!failedTask) {
            return false
        }

        await assertAnalysisAssetsAvailable(
            transaction,
            userId,
            requiredAnalysisImageReferences(failedTask.standardTask),
        )
        await assertAnalysisVideoEvidenceAvailable(transaction, userId, failedTask.standardTask)
        await getTaskPolicy().reserve(
            transaction,
            userId,
            taskId,
            failedTask.resultVersion,
            failedTask.standardTask,
        )

        return requeueFailedAnalysisTask(transaction, taskId, userId)
    })
}
