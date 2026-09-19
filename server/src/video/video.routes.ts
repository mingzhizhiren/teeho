import { Elysia } from 'elysia'

import { authenticatedApiPlugin } from '../middleware/auth'
import {
    handleCancelVideo,
    handleConfirmVideoUpload,
    handleConfirmVideoEvidenceRestore,
    handleCreateVideoEvidenceRestoreSession,
    handleCreateVideoUploadSession,
    handleGetVideoEvidence,
    handleGetVideoStatus,
    handleResumeVideoUpload,
} from './video.controller'

/** 视频上传和预处理 HTTP 路由：`/analysis/video/*`。 */
export const videoRoutes = new Elysia({ prefix: '/analysis/video' })
    .use(authenticatedApiPlugin)
    .post('/upload-sessions', async ({ apiUser, body, set }) => {
        const result = await handleCreateVideoUploadSession(apiUser.id, body)
        set.status = result.status
        return result.response
    })
    .post('/:videoId/complete', async ({ apiUser, params, set }) => {
        const result = await handleConfirmVideoUpload(apiUser.id, params.videoId)
        set.status = result.status
        return result.response
    })
    .post('/:videoId/resume-upload', async ({ apiUser, params, set }) => {
        const result = await handleResumeVideoUpload(apiUser.id, params.videoId)
        set.status = result.status
        return result.response
    })
    .get('/:videoId/evidence', async ({ apiUser, params, set }) => {
        const result = await handleGetVideoEvidence(apiUser.id, params.videoId)
        set.status = result.status
        return result.response
    })
    .post('/:videoId/evidence/restore-sessions', async ({ apiUser, params, body, set }) => {
        const result = await handleCreateVideoEvidenceRestoreSession(
            apiUser.id,
            params.videoId,
            body,
        )
        set.status = result.status
        return result.response
    })
    .post(
        '/:videoId/evidence/restore-sessions/:sessionId/complete',
        async ({ apiUser, params, set }) => {
            const result = await handleConfirmVideoEvidenceRestore(
                apiUser.id,
                params.videoId,
                params.sessionId,
            )
            set.status = result.status
            return result.response
        },
    )
    .delete('/:videoId', async ({ apiUser, params, set }) => {
        const result = await handleCancelVideo(apiUser.id, params.videoId)
        set.status = result.status
        return result.response
    })
    .get('/:videoId', async ({ apiUser, params, set }) => {
        const result = await handleGetVideoStatus(apiUser.id, params.videoId)
        set.status = result.status
        return result.response
    })
