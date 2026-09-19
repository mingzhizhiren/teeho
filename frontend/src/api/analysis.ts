import type { AxiosResponse } from 'axios'
import type { ZodType } from 'zod'

import { HTTP_STATUS } from '@/config/constants'
import { analysisUiConstraints } from '@/features/analysis/analysis.constants'
import {
    analysisAssetCleanupDataSchema,
    analysisDraftPreviewDataSchema,
    analysisMediaAssetDataSchema,
    analysisMediaStatusesDataSchema,
    analysisMediaUploadSessionDataSchema,
    analysisVideoDataSchema,
    analysisVideoUploadSessionDataSchema,
    analysisSubmissionDataSchema,
    analysisTaskConfigDataSchema,
    analysisTaskDataSchema,
    analysisTasksDataSchema,
    latestAnalysisTaskDataSchema,
    type AnalysisDraftPayload,
    type AnalysisMediaUploadSession,
    type AnalysisVideo,
    type AnalysisVideoUploadSession,
    type AnalysisSubmissionRequestOptions,
} from '@/features/analysis/analysis.contract'
import { request, sendBestEffortRequest, type ApiResponse } from '@/utils/request'
import { videoEvidenceDownloadDataSchema } from '@/features/analysis/localVideoEvidence'
import {
    analysisConversationClearDataSchema,
    analysisConversationControlDataSchema,
    analysisConversationTurnDataSchema,
    analysisConversationTurnAckDataSchema,
    analysisConversationTurnRecoveryDataSchema,
    type AnalysisConversationSessionIdentity,
    type AnalysisConversationTurnRequest,
} from '@/features/analysis/analysis.conversation'

export type {
    AnalysisAssetCleanupOutcome,
    AnalysisDraftPayload,
    AnalysisInputAcceptance,
    AnalysisInputMode,
    AnalysisResult,
    AnalysisSubmissionRequestOptions,
    AnalysisTask,
    AnalysisTaskConfig,
    ResolvedTaskField,
    StandardAnalysisTask,
    TaskFieldDefinition,
    TaskFieldName,
    TaskFieldOption,
    TaskFieldSource,
    TaskFieldValue,
} from '@/features/analysis/analysis.contract'

/** 校验分析接口响应并收窄响应数据类型 */
async function validateAnalysisResponse<T>(
    responsePromise: Promise<AxiosResponse<ApiResponse<unknown>>>,
    dataSchema: ZodType<T>,
): Promise<AxiosResponse<ApiResponse<T>>> {
    const response = await responsePromise
    return {
        ...response,
        data: {
            ...response.data,
            data: dataSchema.parse(response.data.data),
        },
    }
}

/** GET `/analysis/task-config` */
export function getAnalysisTaskConfig() {
    return validateAnalysisResponse(
        request.get<ApiResponse<unknown>>('/analysis/task-config'),
        analysisTaskConfigDataSchema,
    )
}

/** POST `/analysis/draft-preview` */
export function previewAnalysisDraft(payload: AnalysisDraftPayload, timeoutMs: number) {
    return validateAnalysisResponse(
        request.post<ApiResponse<unknown>>('/analysis/draft-preview', payload, {
            timeout: timeoutMs,
        }),
        analysisDraftPreviewDataSchema,
    )
}

/** POST `/analysis/conversation/turns`；完整语义历史只随本轮临时传输。 */
export function formAnalysisConversationTurn(
    payload: AnalysisConversationTurnRequest,
    timeoutMs: number,
) {
    return validateAnalysisResponse(
        request.post<ApiResponse<unknown>>('/analysis/conversation/turns', payload, {
            timeout: timeoutMs,
        }),
        analysisConversationTurnDataSchema,
    )
}

/** 查询同一浏览器会话仍未领取的临时 Agent 回合。 */
export async function recoverAnalysisConversationTurn(
    turnId: string,
    session: AnalysisConversationSessionIdentity,
) {
    const response = await validateAnalysisResponse(
        request.post<ApiResponse<unknown>>('/analysis/conversation/turns/recovery', {
            turnId,
            session,
        }),
        analysisConversationTurnRecoveryDataSchema,
    )
    return response.data.data.turn
}

/** IndexedDB 成功保存结果后确认清除云端临时正文。 */
export async function acknowledgeAnalysisConversationTurn(
    turnId: string,
    session: AnalysisConversationSessionIdentity,
) {
    const response = await validateAnalysisResponse(
        request.post<ApiResponse<unknown>>('/analysis/conversation/turns/ack', {
            turnId,
            session,
        }),
        analysisConversationTurnAckDataSchema,
    )
    return response.data.data.acknowledged
}

/** Read the account-authoritative identity without taking over the conversation. */
export async function getAnalysisConversationControl(timeoutMs?: number) {
    const response = await validateAnalysisResponse(
        request.get<ApiResponse<unknown>>('/analysis/conversation/control', {
            ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
        }),
        analysisConversationControlDataSchema,
    )
    return response.data.data.control
}

/** Clear only the exact authoritative conversation identity. */
export async function clearAnalysisConversation(session: AnalysisConversationSessionIdentity) {
    const response = await validateAnalysisResponse(
        request.delete<ApiResponse<unknown>>('/analysis/conversation', {
            data: session,
        }),
        analysisConversationClearDataSchema,
    )
    return response.data.data
}

/** POST `/analysis/tasks` */
export function submitAnalysisTask(
    payload: AnalysisDraftPayload,
    options: AnalysisSubmissionRequestOptions,
) {
    return validateAnalysisResponse(
        request.post<ApiResponse<unknown>>(
            '/analysis/tasks',
            {
                ...payload,
                ...(options.preparationId ? { preparationId: options.preparationId } : {}),
                admission: {
                    schemaVersion: 'analysis-task-admission.v1',
                    confirmationRevision: options.confirmationRevision,
                    session: options.conversationSession,
                    mediaBinding: {
                        contentKind: payload.videoReference
                            ? 'video'
                            : payload.imageReferences.length > 0
                              ? 'image'
                              : 'text',
                        imageReferences: payload.imageReferences,
                        videoReference: payload.videoReference ?? null,
                        coverReference:
                            payload.coverReference ?? payload.imageReferences[0] ?? null,
                    },
                    idempotencyKey: options.submissionId,
                },
            },
            {
                timeout: options.timeoutMs,
            },
        ),
        analysisSubmissionDataSchema,
    )
}

/** GET `/analysis/tasks/admissions/:id`；提交响应未知时读取已成立任务。 */
export async function recoverAnalysisTaskAdmission(submissionId: string) {
    const response = await validateAnalysisResponse(
        request.get<ApiResponse<unknown>>(`/analysis/tasks/admissions/${submissionId}`),
        latestAnalysisTaskDataSchema,
    )
    return response.data.data.task
}

export interface AnalysisMediaUploadDescriptor {
    fileName: string
    declaredMediaType: 'image/jpeg' | 'image/png' | 'image/webp'
    byteSize: number
}

/** 视频直传凭据、对象路径与到期时间。 */
export interface AnalysisVideoUploadDescriptor {
    fileName: string
    declaredMediaType: 'video/mp4' | 'video/quicktime'
    byteSize: number
}

/** 仅发送单视频元数据并申请私有 Storage TUS 直传资格。 */
export async function createAnalysisVideoUploadSession(
    file: AnalysisVideoUploadDescriptor,
): Promise<AnalysisVideoUploadSession> {
    const response = await validateAnalysisResponse(
        request.post<ApiResponse<unknown>>('/analysis/video/upload-sessions', { file }),
        analysisVideoUploadSessionDataSchema,
    )
    return response.data.data.session
}

/** 为刷新后重新选择的同一文件取得新的短期 TUS 续传资格。 */
export async function resumeAnalysisVideoUploadSession(
    videoId: string,
): Promise<AnalysisVideoUploadSession> {
    const response = await validateAnalysisResponse(
        request.post<ApiResponse<unknown>>(`/analysis/video/${videoId}/resume-upload`, {}),
        analysisVideoUploadSessionDataSchema,
    )
    return response.data.data.session
}

/** 通知后端复核已完成的 TUS 对象并进入预处理队列。 */
export async function confirmAnalysisVideoUpload(videoId: string): Promise<AnalysisVideo> {
    const response = await validateAnalysisResponse(
        request.post<ApiResponse<unknown>>(`/analysis/video/${videoId}/complete`, {}),
        analysisVideoDataSchema,
    )
    return response.data.data.video
}

/** 读取认证账号拥有的视频预处理状态。 */
export async function getAnalysisVideoStatus(videoId: string): Promise<AnalysisVideo> {
    const response = await validateAnalysisResponse(
        request.get<ApiResponse<unknown>>(`/analysis/video/${videoId}`),
        analysisVideoDataSchema,
    )
    return response.data.data.video
}

/** 删除或替换草稿视频时取消预处理并触发服务端清理。 */
export async function cancelAnalysisVideo(videoId: string): Promise<AnalysisVideo> {
    const response = await validateAnalysisResponse(
        request.delete<ApiResponse<unknown>>(`/analysis/video/${videoId}`),
        analysisVideoDataSchema,
    )
    return response.data.data.video
}

/** 取得当前账号仍在云端保留期内的视频证据清单与关键帧下载资格。 */
export async function getAnalysisVideoEvidence(videoId: string) {
    const response = await validateAnalysisResponse(
        request.get<ApiResponse<unknown>>(`/analysis/video/${videoId}/evidence`),
        videoEvidenceDownloadDataSchema,
    )
    return response.data.data.bundle
}

/** 只向题火后端发送图片元数据并申请私有 Storage 直传资格。 */
export async function createAnalysisMediaUploadSession(
    files: AnalysisMediaUploadDescriptor[],
): Promise<AnalysisMediaUploadSession> {
    const response = await validateAnalysisResponse(
        request.post<ApiResponse<unknown>>('/analysis/media/upload-sessions', {
            files,
        }),
        analysisMediaUploadSessionDataSchema,
    )
    return response.data.data.session
}

/** 浏览器直接把原图写入一次性签名地址，并报告真实传输进度。 */
export function uploadAnalysisMediaDirectly(
    uploadUrl: string,
    file: File,
    onProgress: (percentage: number) => void,
) {
    return new Promise<void>((resolve, reject) => {
        const formData = new FormData()
        formData.append('cacheControl', '3600')
        formData.append('', file)

        const xhr = new XMLHttpRequest()
        xhr.open('PUT', uploadUrl)
        xhr.setRequestHeader('x-upsert', 'false')
        xhr.upload.addEventListener('progress', (event) => {
            if (!event.lengthComputable || event.total <= 0) return
            onProgress(
                Math.round((event.loaded / event.total) * analysisUiConstraints.percentageComplete),
            )
        })
        xhr.addEventListener('load', () => {
            if (xhr.status >= HTTP_STATUS.SUCCESS_MIN && xhr.status < HTTP_STATUS.REDIRECTION_MIN) {
                onProgress(analysisUiConstraints.percentageComplete)
                resolve()
                return
            }
            reject(new Error('图片上传失败'))
        })
        xhr.addEventListener('error', () => reject(new Error('图片上传失败')))
        xhr.addEventListener('abort', () => reject(new Error('图片上传已取消')))
        xhr.send(formData)
    })
}

/** 通知后端核验对象并开始异步处理。 */
export async function confirmAnalysisMediaUpload(assetId: string) {
    const response = await validateAnalysisResponse(
        request.post<ApiResponse<unknown>>(`/analysis/media/${assetId}/complete`, {}),
        analysisMediaAssetDataSchema,
    )
    return response.data.data.asset
}

/** 短时批量读取图片处理状态。 */
export async function getAnalysisMediaStatuses(assetIds: string[]) {
    const response = await validateAnalysisResponse(
        request.post<ApiResponse<unknown>>('/analysis/media/statuses', { assetIds }),
        analysisMediaStatusesDataSchema,
    )
    return response.data.data.assets
}

/** 对保留期内的处理失败图片发起有限重试。 */
export async function retryAnalysisMedia(assetId: string) {
    const response = await validateAnalysisResponse(
        request.post<ApiResponse<unknown>>(`/analysis/media/${assetId}/retry`, {}),
        analysisMediaAssetDataSchema,
    )
    return response.data.data.asset
}

/** GET `/analysis/tasks/latest` */
export function getLatestAnalysisTask() {
    return validateAnalysisResponse(
        request.get<ApiResponse<unknown>>('/analysis/tasks/latest'),
        latestAnalysisTaskDataSchema,
    )
}

/** GET `/analysis/tasks/:taskId` */
export function getAnalysisTask(taskId: string) {
    return validateAnalysisResponse(
        request.get<ApiResponse<unknown>>(`/analysis/tasks/${taskId}`),
        analysisTaskDataSchema,
    )
}

/** GET `/analysis/tasks` */
export function getAnalysisTasks() {
    return validateAnalysisResponse(
        request.get<ApiResponse<unknown>>('/analysis/tasks'),
        analysisTasksDataSchema,
    )
}

/** POST `/analysis/tasks/:taskId/abandon` */
export function abandonAnalysisTask(taskId: string) {
    return validateAnalysisResponse(
        request.post<ApiResponse<unknown>>(`/analysis/tasks/${taskId}/abandon`),
        analysisTaskDataSchema,
    )
}

/** DELETE `/analysis/tasks/:taskId/temp-assets` */
export function cleanupAnalysisTaskAssets(taskId: string) {
    return validateAnalysisResponse(
        request.delete<ApiResponse<unknown>>(`/analysis/tasks/${taskId}/temp-assets`),
        analysisAssetCleanupDataSchema,
    )
}

/** DELETE `/analysis/temp-assets`：页面刷新时仍尽力送达的异步清理意图。 */
export function cleanupAnalysisUserAssets() {
    return sendBestEffortRequest('/analysis/temp-assets', 'DELETE')
}

/** POST `/analysis/tasks/:taskId/retry` */
export function retryAnalysisTask(taskId: string) {
    return validateAnalysisResponse(
        request.post<ApiResponse<unknown>>(`/analysis/tasks/${taskId}/retry`),
        analysisTaskDataSchema,
    )
}

/** POST `/analysis/tasks/:taskId/reanalyze` */
export function reanalyzeAnalysisTask(taskId: string, submissionId: string) {
    return validateAnalysisResponse(
        request.post<ApiResponse<unknown>>(`/analysis/tasks/${taskId}/reanalyze`, { submissionId }),
        analysisTaskDataSchema,
    )
}
