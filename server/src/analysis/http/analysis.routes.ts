import { Elysia } from 'elysia'

import { authenticatedApiPlugin } from '../../middleware/auth'
import {
    handleAcknowledgeAnalysisConversationTurn,
    handleAnalysisConversationTurn,
    handleClearAnalysisConversation,
    handleGetAnalysisConversationControl,
    handleRecoverAnalysisConversationTurn,
} from '../conversation/analysis.conversation.controller'
import {
    handleConfirmAnalysisMediaUpload,
    handleCreateAnalysisMediaUploadSession,
    handleGetAnalysisMediaStatuses,
    handleRetryAnalysisMedia,
} from '../media/analysis.media.controller'
import {
    handleAbandonAnalysisTask,
    handleCleanupAnalysisTaskAssets,
    handleCleanupAnalysisUserAssets,
    handleGetAnalysisTask,
    handleGetAnalysisTaskAdmission,
    handleGetAnalysisTaskConfig,
    handleGetAnalysisTasks,
    handleGetLatestAnalysisTask,
    handlePreviewAnalysisDraft,
    handleReanalyzeAnalysisTask,
    handleRetryAnalysisTask,
    handleSubmitAnalysisTask,
} from './analysis.controller'

/** 分析任务 HTTP 路由：`/analysis/*` */
export const analysisRoutes = new Elysia({ prefix: '/analysis' })
    .use(authenticatedApiPlugin)
    .get('/task-config', async ({ set }) => {
        const result = await handleGetAnalysisTaskConfig()
        set.status = result.status
        return result.response
    })
    .post('/media/upload-sessions', async ({ apiUser, body, set }) => {
        const result = await handleCreateAnalysisMediaUploadSession(apiUser.id, body)
        set.status = result.status
        return result.response
    })
    .post('/media/:assetId/complete', async ({ apiUser, params, set }) => {
        const result = await handleConfirmAnalysisMediaUpload(apiUser.id, params.assetId)
        set.status = result.status
        return result.response
    })
    .post('/media/statuses', async ({ apiUser, body, set }) => {
        const result = await handleGetAnalysisMediaStatuses(apiUser.id, body)
        set.status = result.status
        return result.response
    })
    .post('/media/:assetId/retry', async ({ apiUser, params, set }) => {
        const result = await handleRetryAnalysisMedia(apiUser.id, params.assetId)
        set.status = result.status
        return result.response
    })
    .post('/draft-preview', async ({ apiUser, body, request, set }) => {
        const result = await handlePreviewAnalysisDraft(apiUser.id, body, request.signal)
        set.status = result.status
        const headers = 'headers' in result ? result.headers : undefined
        if (headers) {
            set.headers = headers
        }
        return result.response
    })
    .post('/conversation/turns', async ({ apiUser, apiAuthSessionKey, body, set }) => {
        const result = await handleAnalysisConversationTurn(apiUser.id, apiAuthSessionKey, body)
        set.status = result.status
        if ('headers' in result && result.headers) {
            set.headers['Retry-After'] = result.headers['Retry-After']
        }
        return result.response
    })
    .post('/conversation/turns/recovery', async ({ apiUser, body, set }) => {
        const result = await handleRecoverAnalysisConversationTurn(apiUser.id, body)
        set.status = result.status
        return result.response
    })
    .post('/conversation/turns/ack', async ({ apiUser, body, set }) => {
        const result = await handleAcknowledgeAnalysisConversationTurn(apiUser.id, body)
        set.status = result.status
        return result.response
    })
    .get('/conversation/control', async ({ apiUser, set }) => {
        const result = await handleGetAnalysisConversationControl(apiUser.id)
        set.status = result.status
        return result.response
    })
    .delete('/conversation', async ({ apiUser, body, set }) => {
        const result = await handleClearAnalysisConversation(apiUser.id, body)
        set.status = result.status
        return result.response
    })
    .post('/tasks', async ({ apiUser, body, request, set }) => {
        const result = await handleSubmitAnalysisTask(apiUser.id, body, request.signal)
        set.status = result.status
        const headers = 'headers' in result ? result.headers : undefined
        if (headers) {
            set.headers = headers
        }
        return result.response
    })
    .get('/tasks/latest', async ({ apiUser, set }) => {
        const result = await handleGetLatestAnalysisTask(apiUser.id)
        set.status = result.status
        return result.response
    })
    .get('/tasks/admissions/:submissionId', async ({ apiUser, params, set }) => {
        const result = await handleGetAnalysisTaskAdmission(apiUser.id, params.submissionId)
        set.status = result.status
        return result.response
    })
    .get('/tasks', async ({ apiUser, set }) => {
        const result = await handleGetAnalysisTasks(apiUser.id)
        set.status = result.status
        return result.response
    })
    .delete('/temp-assets', async ({ apiUser, set }) => {
        const result = await handleCleanupAnalysisUserAssets(apiUser.id)
        set.status = result.status
        return result.response
    })
    .delete('/tasks/:taskId/temp-assets', async ({ apiUser, params, set }) => {
        const result = await handleCleanupAnalysisTaskAssets(apiUser.id, params.taskId)
        set.status = result.status
        return result.response
    })
    .post('/tasks/:taskId/abandon', async ({ apiUser, params, set }) => {
        const result = await handleAbandonAnalysisTask(apiUser.id, params.taskId)
        set.status = result.status
        return result.response
    })
    .post('/tasks/:taskId/retry', async ({ apiUser, params, set }) => {
        const result = await handleRetryAnalysisTask(apiUser.id, params.taskId)
        set.status = result.status
        return result.response
    })
    .post('/tasks/:taskId/reanalyze', async ({ apiUser, params, body, set }) => {
        const result = await handleReanalyzeAnalysisTask(apiUser.id, params.taskId, body)
        set.status = result.status
        return result.response
    })
    .get('/tasks/:taskId', async ({ apiUser, params, set }) => {
        const result = await handleGetAnalysisTask(apiUser.id, params.taskId)
        set.status = result.status
        return result.response
    })
