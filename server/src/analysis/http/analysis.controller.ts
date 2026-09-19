import { z } from 'zod'

import { API_CODES, HTTP_STATUS } from '../../config/constants'

import { fail, ok, type ApiResult } from '../../utils/response'

import {
    cleanupAnalysisTaskAssets,
    requestAnalysisUserAssetCleanupBestEffort,
} from '../media/analysis.asset-lifecycle.service'

import {
    abandonAnalysisTask,
    getAnalysisTask,
    getAnalysisTaskAdmission,
    getAnalysisTaskConfig,
    getAnalysisTasks,
    getLatestAnalysisTask,
    previewAnalysisDraft,
    reanalyzeAnalysisTask,
    retryAnalysisTask,
    submitAnalysisTask,
} from '../analysis.service'

import { recordTaskAdmissionBlock } from './analysis.http-events'
import { domainErrorResponse } from './analysis.http-errors'
import { parseAnalysisRequest } from './analysis.http-input'

const taskIdSchema = z.string().uuid()

const reanalysisBodySchema = z.object({ submissionId: taskIdSchema }).strict()

const taskMutationConfig = {
    abandon: {
        mutate: abandonAnalysisTask,
        successMessage: '已放弃分析',
    },
    retry: {
        mutate: retryAnalysisTask,
        successMessage: '任务已重新排队',
    },
} as const

type TaskMutation = keyof typeof taskMutationConfig

/** 统一执行任务变更并处理领域错误 */
async function handleTaskMutation(userId: string, taskId: unknown, mutation: TaskMutation) {
    const parsedTaskId = taskIdSchema.safeParse(taskId)
    if (!parsedTaskId.success) {
        return {
            status: 400,
            response: fail(API_CODES.VALIDATION_ERROR, '任务标识无效'),
        }
    }
    try {
        const config = taskMutationConfig[mutation]
        const task = await config.mutate(userId, parsedTaskId.data)
        return { status: 200, response: ok({ task }, config.successMessage) }
    } catch (error) {
        return domainErrorResponse(error)
    }
}

/** 校验并预览共享图文任务草稿 */
export async function handlePreviewAnalysisDraft(
    userId: string,
    body: unknown,
    signal?: AbortSignal,
) {
    const parsed = parseAnalysisRequest(body)
    if (!parsed.success) {
        return {
            status: 400,
            response: fail(API_CODES.VALIDATION_ERROR, parsed.message),
        }
    }

    try {
        const preview = await previewAnalysisDraft(userId, parsed.data.draft, {
            signal,
        })
        return { status: 200, response: ok(preview) }
    } catch (error) {
        return domainErrorResponse(error)
    }
}

/** 返回版本化标准任务和上传限制配置 */
export async function handleGetAnalysisTaskConfig() {
    return { status: 200, response: ok({ config: await getAnalysisTaskConfig() }) }
}

/** 校验图文草稿并立即创建后台排队任务 */
export async function handleSubmitAnalysisTask(
    userId: string,
    body: unknown,
    signal?: AbortSignal,
) {
    const parsed = parseAnalysisRequest(body)
    if (!parsed.success) {
        return {
            status: 400,
            response: fail(API_CODES.VALIDATION_ERROR, parsed.message),
        }
    }
    if (!parsed.data.admission) {
        return {
            status: 400,
            response: fail(API_CODES.VALIDATION_ERROR, '请重新确认当前任务'),
        }
    }

    try {
        const outcome = await submitAnalysisTask(userId, parsed.data.draft, {
            admission: parsed.data.admission,
            preparationId: parsed.data.preparationId,
            submissionId: parsed.data.submissionId,
            signal,
        })
        return {
            status: outcome.task ? HTTP_STATUS.CREATED : HTTP_STATUS.OK,
            response: ok(
                outcome,
                outcome.task ? '任务已进入后台分析' : (outcome.acceptance.message ?? '任务未受理'),
            ),
        }
    } catch (error) {
        recordTaskAdmissionBlock(
            userId,
            parsed.data.draft,
            parsed.data.submissionId ?? parsed.data.admission.idempotencyKey,
            error,
        )
        return domainErrorResponse(error)
    }
}

/** 读取当前用户最近的任务 */
export async function handleGetLatestAnalysisTask(userId: string) {
    const task = await getLatestAnalysisTask(userId)
    return { status: 200, response: ok({ task }) }
}

/** 提交响应未知时按幂等身份恢复已成立任务；不存在时明确返回空。 */
export async function handleGetAnalysisTaskAdmission(userId: string, submissionId: unknown) {
    const parsedSubmissionId = taskIdSchema.safeParse(submissionId)
    if (!parsedSubmissionId.success) {
        return {
            status: 400,
            response: fail(API_CODES.VALIDATION_ERROR, '提交标识无效'),
        }
    }
    const task = await getAnalysisTaskAdmission(userId, parsedSubmissionId.data)
    return { status: 200, response: ok({ task }) }
}

/** 读取当前用户最近任务列表 */
export async function handleGetAnalysisTasks(userId: string) {
    const tasks = await getAnalysisTasks(userId)
    return { status: 200, response: ok({ tasks }) }
}

/** 校验任务标识并读取当前用户自己的任务 */
export async function handleGetAnalysisTask(userId: string, taskId: unknown) {
    const parsedTaskId = taskIdSchema.safeParse(taskId)
    if (!parsedTaskId.success) {
        return {
            status: 400,
            response: fail(API_CODES.VALIDATION_ERROR, '任务标识无效'),
        }
    }

    const task = await getAnalysisTask(userId, parsedTaskId.data)
    if (!task) {
        return {
            status: 404,
            response: fail(API_CODES.NOT_FOUND, '分析任务不存在'),
        }
    }

    return { status: 200, response: ok({ task }) }
}

/** 放弃资料搜集、等待、执行或重试中的任务。 */
export async function handleAbandonAnalysisTask(userId: string, taskId: unknown) {
    return handleTaskMutation(userId, taskId, 'abandon')
}

/** 用户删除单条本地历史时登记对应临时素材的定时清理意图。 */
export async function handleCleanupAnalysisTaskAssets(userId: string, taskId: unknown) {
    const parsedTaskId = taskIdSchema.safeParse(taskId)
    if (!parsedTaskId.success) {
        return {
            status: 400,
            response: fail(API_CODES.VALIDATION_ERROR, '任务标识无效'),
        }
    }

    const cleanup = await cleanupAnalysisTaskAssets(userId, parsedTaskId.data)
    return { status: 200, response: ok({ cleanup }, '临时素材清理请求已处理') }
}

/** “退出并清除”时登记当前账号全部临时素材的定时清理意图。 */
export async function handleCleanupAnalysisUserAssets(userId: string) {
    requestAnalysisUserAssetCleanupBestEffort(userId)
    return {
        status: HTTP_STATUS.ACCEPTED,
        response: ok({ accepted: true }, '账号临时素材清理请求已受理'),
    }
}

/** 人工重试自动重试后仍失败的任务 */
export async function handleRetryAnalysisTask(userId: string, taskId: unknown) {
    return handleTaskMutation(userId, taskId, 'retry')
}

/** 以客户端稳定提交标识受理再次体检，响应未知重试复用同一身份。 */
export async function handleReanalyzeAnalysisTask(
    userId: string,
    sourceTaskId: unknown,
    body: unknown,
): Promise<{ status: number; response: ApiResult<unknown> }> {
    const parsedTaskId = taskIdSchema.safeParse(sourceTaskId)
    const parsedBody = reanalysisBodySchema.safeParse(body)
    if (!parsedTaskId.success || !parsedBody.success) {
        return {
            status: HTTP_STATUS.BAD_REQUEST,
            response: fail(API_CODES.VALIDATION_ERROR, '再次体检的任务或提交标识无效'),
        }
    }
    try {
        const task = await reanalyzeAnalysisTask(
            userId,
            parsedTaskId.data,
            parsedBody.data.submissionId,
        )
        return { status: HTTP_STATUS.OK, response: ok({ task }, '已受理再次体检') }
    } catch (error) {
        return domainErrorResponse(error)
    }
}
