import { createHash } from 'node:crypto'
import path from 'node:path'

import sharp from 'sharp'

import { BYTE_SIZE } from '../../config/constants'
import { analysisTaskConfig } from '../analysis.config'
import { analysisMediaConstraints } from '../analysis.constants'
import { normalizeImage } from './analysis.image-normalization'

export type AnalysisImageValidationCode =
    | 'too_many_images'
    | 'image_too_large'
    | 'image_batch_too_large'
    | 'unsupported_image_type'
    | 'spoofed_image_type'
    | 'image_decode_failed'
    | 'image_pixel_limit'
    | 'animated_image_unsupported'

/** 图片上传或处理的稳定业务校验错误。 */
export class AnalysisImageValidationError extends Error {
    constructor(
        readonly code: AnalysisImageValidationCode,
        message: string,
    ) {
        super(message)
        this.name = 'AnalysisImageValidationError'
    }
}

export interface AnalysisUploadDescriptor {
    fileName: string
    declaredMediaType: string
    byteSize: number
}

export interface ProcessedAnalysisImage {
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
    byteSize: number
    width: number
    height: number
    originalSha256: string
    processedSha256: string
    content: Uint8Array
}

const imageFormats = {
    jpeg: {
        mediaType: 'image/jpeg',
        extensions: new Set(['.jpg', '.jpeg', '.jpe']),
        declaredMediaTypes: new Set(['image/jpeg', 'image/jpg']),
    },
    png: {
        mediaType: 'image/png',
        extensions: new Set(['.png']),
        declaredMediaTypes: new Set(['image/png']),
    },
    webp: {
        mediaType: 'image/webp',
        extensions: new Set(['.webp']),
        declaredMediaTypes: new Set(['image/webp']),
    },
} as const

type SupportedImageFormat = keyof typeof imageFormats

function isSupportedFormat(format: string | undefined): format is SupportedImageFormat {
    return format === 'jpeg' || format === 'png' || format === 'webp'
}

/** 在签发上传资格前校验客户端可知的数量和容量边界。 */
export function validateAnalysisUploadDescriptors(files: AnalysisUploadDescriptor[]) {
    const limits = analysisTaskConfig.uploads
    if (files.length === 0 || files.length > limits.maxFiles) {
        throw new AnalysisImageValidationError(
            'too_many_images',
            `单个任务最多上传 ${limits.maxFiles} 张图片`,
        )
    }
    let totalBytes = 0
    for (const file of files) {
        if (file.byteSize <= 0 || file.byteSize > limits.maxFileBytes) {
            throw new AnalysisImageValidationError(
                'image_too_large',
                `单张图片不能超过 ${Math.round(limits.maxFileBytes / BYTE_SIZE.MEBIBYTE)} MB`,
            )
        }
        const declared = file.declaredMediaType.toLocaleLowerCase()
        const extension = path.extname(file.fileName).toLocaleLowerCase()
        if (
            !Object.values(imageFormats).some(
                (config) =>
                    config.declaredMediaTypes.has(declared as never) &&
                    config.extensions.has(extension as never),
            )
        ) {
            throw new AnalysisImageValidationError(
                'unsupported_image_type',
                '只支持 JPEG、PNG 和 WebP 图片',
            )
        }
        totalBytes += file.byteSize
    }
    if (totalBytes > limits.maxTotalBytes) {
        throw new AnalysisImageValidationError(
            'image_batch_too_large',
            `单个任务图片总量不能超过 ${Math.round(limits.maxTotalBytes / BYTE_SIZE.MEBIBYTE)} MB`,
        )
    }
    return totalBytes
}

function assertTrueFormat(
    format: SupportedImageFormat,
    input: { fileName: string; declaredMediaType: string },
) {
    const config = imageFormats[format]
    if (
        !config.extensions.has(path.extname(input.fileName).toLocaleLowerCase() as never) ||
        !config.declaredMediaTypes.has(input.declaredMediaType.toLocaleLowerCase() as never)
    ) {
        throw new AnalysisImageValidationError('spoofed_image_type', '图片声明类型与真实格式不一致')
    }
}

/** 完整解码原图并生成供 Agent 理解的 2048px 派生图。 */
export async function processAnalysisImage(
    inputContent: Uint8Array,
    input: { fileName: string; declaredMediaType: string },
): Promise<ProcessedAnalysisImage> {
    const options = {
        failOn: 'warning' as const,
        limitInputPixels: analysisTaskConfig.uploads.maxPixels,
        sequentialRead: true,
    }
    try {
        const source = sharp(inputContent, options)
        const metadata = await source.metadata()
        if (!isSupportedFormat(metadata.format)) {
            throw new AnalysisImageValidationError(
                'unsupported_image_type',
                '只支持 JPEG、PNG 和 WebP 图片',
            )
        }
        if (!metadata.width || !metadata.height) {
            throw new AnalysisImageValidationError('image_decode_failed', '图片无法完整解码')
        }
        if ((metadata.pages ?? 1) > 1) {
            throw new AnalysisImageValidationError(
                'animated_image_unsupported',
                '暂不支持动态或多帧图片',
            )
        }
        if (metadata.width * metadata.height > analysisTaskConfig.uploads.maxPixels) {
            throw new AnalysisImageValidationError(
                'image_pixel_limit',
                `单张图片解码后不能超过 ${analysisTaskConfig.uploads.maxPixels} 像素`,
            )
        }
        assertTrueFormat(metadata.format, input)
        const normalized = await normalizeImage(inputContent, {
            inputPixelLimit: analysisTaskConfig.uploads.maxPixels,
            maxEdgePixels: analysisMediaConstraints.derivedMaxEdgePixels,
            outputFormat: metadata.format,
            lossyQuality: analysisMediaConstraints.lossyQuality,
        })
        return {
            ...normalized,
            originalSha256: createHash('sha256').update(inputContent).digest('hex'),
            processedSha256: createHash('sha256').update(normalized.content).digest('hex'),
        }
    } catch (error) {
        if (error instanceof AnalysisImageValidationError) {
            throw error
        }
        throw new AnalysisImageValidationError(
            'image_decode_failed',
            '图片格式无效、内容损坏或存在不安全的解码数据',
        )
    }
}
