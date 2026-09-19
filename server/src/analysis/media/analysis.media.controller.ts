import { z } from 'zod'

import { API_CODES, HTTP_STATUS } from '../../config/constants'

import { fail, ok } from '../../utils/response'

import { analysisMediaService } from './analysis.media.service'

import { AnalysisMediaUploadRateLimitError } from './analysis.media-upload-admission'

import { analysisMediaConstraints, analysisUploadConstraints } from '../analysis.constants'

import { domainErrorResponse } from '../http/analysis.http-errors'

const mediaAssetIdSchema = z.string().uuid()

const mediaUploadSessionBodySchema = z
    .object({
        files: z
            .array(
                z
                    .object({
                        fileName: z
                            .string()
                            .trim()
                            .min(1)
                            .max(analysisMediaConstraints.originalFileNameMaxLength),
                        declaredMediaType: z.enum(analysisUploadConstraints.allowedMediaTypes),
                        byteSize: z.number().int().positive(),
                    })
                    .strict(),
            )
            .min(1)
            .max(analysisUploadConstraints.maxFiles),
    })
    .strict()

const mediaStatusesBodySchema = z
    .object({
        assetIds: z.array(mediaAssetIdSchema).min(1).max(analysisUploadConstraints.maxFiles),
    })
    .strict()

/** 签发不经过题火应用进程的私有图片直传资格。 */
export async function handleCreateAnalysisMediaUploadSession(userId: string, body: unknown) {
    const parsed = mediaUploadSessionBodySchema.safeParse(body)
    if (!parsed.success) {
        return {
            status: 400,
            response: fail(API_CODES.VALIDATION_ERROR, '图片上传信息无效'),
        }
    }
    try {
        const session = await analysisMediaService.createUploadSession(userId, parsed.data.files)
        return { status: HTTP_STATUS.CREATED, response: ok({ session }) }
    } catch (error) {
        return domainErrorResponse(error)
    }
}

/** 确认一张图片已直传并投入短时异步处理。 */
export async function handleConfirmAnalysisMediaUpload(userId: string, assetId: unknown) {
    const parsed = mediaAssetIdSchema.safeParse(assetId)
    if (!parsed.success) {
        return {
            status: 400,
            response: fail(API_CODES.VALIDATION_ERROR, '图片素材标识无效'),
        }
    }
    try {
        const asset = await analysisMediaService.confirmUpload(userId, parsed.data)
        return { status: 200, response: ok({ asset }) }
    } catch (error) {
        if (error instanceof AnalysisMediaUploadRateLimitError) {
            return domainErrorResponse(error)
        }
        return {
            status: 400,
            response: fail(
                API_CODES.VALIDATION_ERROR,
                error instanceof Error ? error.message : '图片上传确认失败',
            ),
        }
    }
}

/** 短时轮询读取当前账号素材处理状态。 */
export async function handleGetAnalysisMediaStatuses(userId: string, body: unknown) {
    const parsed = mediaStatusesBodySchema.safeParse(body)
    if (!parsed.success) {
        return {
            status: 400,
            response: fail(API_CODES.VALIDATION_ERROR, '图片素材标识无效'),
        }
    }
    try {
        const assets = await analysisMediaService.getStatuses(userId, parsed.data.assetIds)
        return { status: 200, response: ok({ assets }) }
    } catch (error) {
        if (error instanceof AnalysisMediaUploadRateLimitError) {
            return domainErrorResponse(error)
        }
        return {
            status: 404,
            response: fail(API_CODES.NOT_FOUND, '图片素材不存在'),
        }
    }
}

/** 用户对仍在保留期内的处理失败图片发起有限重试。 */
export async function handleRetryAnalysisMedia(userId: string, assetId: unknown) {
    const parsed = mediaAssetIdSchema.safeParse(assetId)
    if (!parsed.success) {
        return {
            status: 400,
            response: fail(API_CODES.VALIDATION_ERROR, '图片素材标识无效'),
        }
    }
    try {
        const asset = await analysisMediaService.retry(userId, parsed.data)
        return { status: 200, response: ok({ asset }) }
    } catch (error) {
        if (error instanceof AnalysisMediaUploadRateLimitError) {
            return domainErrorResponse(error)
        }
        return {
            status: 409,
            response: fail(API_CODES.CONFLICT, '图片无法重试，请移除后重新选择'),
        }
    }
}
