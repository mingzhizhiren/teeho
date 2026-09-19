import type { DatabaseTransaction } from '../db/database'
import type { CreateVideoUploadParam, VideoAdmissionPolicy } from '../video/video.repository'

export type AuthorizeVideoUpload = (
    executor: DatabaseTransaction,
    upload: CreateVideoUploadParam,
    policy: VideoAdmissionPolicy,
) => Promise<void>

let authorizeUpload: AuthorizeVideoUpload = async () => {}

/** 部署方在视频事务内追加准入条件，不改变上传所有权和容量校验。 */
export function configureVideoAuthorization(authorize: AuthorizeVideoUpload): void {
    authorizeUpload = authorize
}

export const authorizeVideoUpload: AuthorizeVideoUpload = (...args) => authorizeUpload(...args)
