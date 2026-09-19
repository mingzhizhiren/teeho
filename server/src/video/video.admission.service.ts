import { withTransaction } from '../db/database'
import { requestAnalysisMediaCleanupRunBestEffort } from '../analysis/media/analysis.asset-lifecycle.service'
import { AnalysisMediaUploadRateLimitError } from '../analysis/media/analysis.media-upload-admission'
import { admitAnalysisMediaUpload } from '../analysis/media/analysis.media-upload-admission.repository'
import { authorizeVideoUpload, type AuthorizeVideoUpload } from '../runtime/video-policy'
import {
    assertVideoAdmission,
    cancelVideoAsset,
    findOwnedVideoAsset,
    insertVideoUpload,
    markVideoQueued,
    type CreateVideoUploadParam,
    type VideoAdmissionPolicy,
    type VideoPersistence,
} from './video.repository'

/** 视频准入依赖；云端验收可注入隔离事务而不复制生产 SQL。 */
export interface VideoAdmissionServiceDependencies {
    withTransaction: typeof withTransaction
    authorizeUpload: AuthorizeVideoUpload
}

/** 在单个数据库事务里协调视频容量门禁与积分域权益快照。 */
export function createVideoAdmissionService(
    dependencies: VideoAdmissionServiceDependencies = {
        withTransaction,
        authorizeUpload: authorizeVideoUpload,
    },
) {
    return async function admitVideoUpload(
        param: CreateVideoUploadParam,
        policy: VideoAdmissionPolicy,
    ) {
        const admitted = await dependencies.withTransaction(async (transaction) => {
            const mediaDecision = await admitAnalysisMediaUpload(transaction, param.userId, {
                kind: 'video',
                count: 1,
            })
            if (!mediaDecision.admitted) return false
            await assertVideoAdmission(transaction, param, policy)
            await dependencies.authorizeUpload(transaction, param, policy)
            await insertVideoUpload(transaction, param)
            return true
        })
        if (admitted) return
        requestAnalysisMediaCleanupRunBestEffort()
        throw new AnalysisMediaUploadRateLimitError()
    }
}

/** 按集中准入策略签发视频上传资格。 */
export const admitVideoUpload = createVideoAdmissionService()

/** PostgreSQL 视频上传持久化实现。 */
export const postgresVideoPersistence: VideoPersistence = {
    createUpload: admitVideoUpload,
    findOwned: findOwnedVideoAsset,
    markQueued: markVideoQueued,
    cancelOwned: cancelVideoAsset,
}
