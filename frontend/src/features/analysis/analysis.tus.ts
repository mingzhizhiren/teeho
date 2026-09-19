import type { UploadOptions } from 'tus-js-client'

import { BYTE_SIZE, TIME_MS } from '@/config/constants'
import type { AnalysisVideoUploadQualification } from './analysis.video-upload'

const tusChunkMebibytes = 6
const completeUploadPercentage = 100
const badRequestHttpStatus = 400
const initialRetryDelayMs = 0
const firstRetryDelaySeconds = 1
const thirdRetryDelaySeconds = 3
const fifthRetryDelaySeconds = 5
const tusRetryDelaysMs = [
    initialRetryDelayMs,
    firstRetryDelaySeconds * TIME_MS.SECOND,
    thirdRetryDelaySeconds * TIME_MS.SECOND,
    fifthRetryDelaySeconds * TIME_MS.SECOND,
]

interface TusHttpResponseLike {
    getStatus(): number
    getBody(): string
}

interface TusErrorLike {
    name?: unknown
    originalResponse?: unknown
}

function readTusHttpResponse(error: unknown) {
    const candidate = typeof error === 'object' && error !== null ? (error as TusErrorLike) : null
    const response = candidate?.originalResponse
    if (
        typeof response !== 'object' ||
        response === null ||
        !('getStatus' in response) ||
        typeof response.getStatus !== 'function' ||
        !('getBody' in response) ||
        typeof response.getBody !== 'function'
    ) {
        return { candidate, response: null }
    }
    return { candidate, response: response as TusHttpResponseLike }
}

function readStorageError(body: string) {
    try {
        const parsed = JSON.parse(body) as Record<string, unknown>
        return {
            code:
                typeof parsed.code === 'string'
                    ? parsed.code
                    : typeof parsed.error === 'string'
                      ? parsed.error
                      : null,
            message: typeof parsed.message === 'string' ? parsed.message : null,
        }
    } catch {
        return { code: null, message: null }
    }
}

/** TUS 错误的安全调试摘要；不返回签名、对象名或响应正文。 */
export function readTusUploadDebugFields(error: unknown) {
    const { candidate, response } = readTusHttpResponse(error)
    const responseBody = response?.getBody() ?? ''
    const storageError = readStorageError(responseBody)

    return {
        errorName:
            typeof candidate?.name === 'string' && candidate.name ? candidate.name : 'UnknownError',
        httpStatus: response?.getStatus() ?? null,
        responseCode: storageError.code,
        responseBodyLength: responseBody.length,
        hasResponseBody: responseBody.length > 0,
    }
}

/** 当前 Supabase Storage 对签名 TUS 的已知兼容性失败。 */
export function isSignedTusCompatibilityError(error: unknown) {
    const { response } = readTusHttpResponse(error)
    if (response?.getStatus() !== badRequestHttpStatus) {
        return false
    }
    const storageError = readStorageError(response.getBody())
    return storageError.code === 'AccessDenied' && storageError.message === 'Invalid Compact JWS'
}

/** 从签名 TUS 资格构造无需额外 API 密钥的标准签名 PUT 地址。 */
export function createStandardSignedUploadUrl(qualification: AnalysisVideoUploadQualification) {
    const url = new URL(qualification.endpoint)
    const objectPath = qualification.objectName
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')
    url.pathname = `/storage/v1/object/upload/sign/${encodeURIComponent(
        qualification.bucketName,
    )}/${objectPath}`
    url.search = ''
    url.hash = ''
    url.searchParams.set('token', qualification.signature)
    return url.toString()
}

/** 生成 Supabase Storage 签名 TUS 上传选项；进度仅代表浏览器上传字节。 */
export function createTusUploadOptions(
    qualification: AnalysisVideoUploadQualification,
    file: File,
    onProgress: (percentage: number) => void,
    onSuccess: () => void,
    onError: (error: Error) => void,
): UploadOptions {
    return {
        endpoint: qualification.endpoint,
        chunkSize: tusChunkMebibytes * BYTE_SIZE.MEBIBYTE,
        uploadSize: file.size,
        fingerprint: (selectedFile) =>
            Promise.resolve(
                [
                    'teeho-video',
                    qualification.bucketName,
                    qualification.objectName,
                    selectedFile.name,
                    selectedFile.type,
                    selectedFile.size,
                    selectedFile.lastModified,
                ].join(':'),
            ),
        headers: {
            'x-signature': qualification.signature,
        },
        metadata: {
            bucketName: qualification.bucketName,
            objectName: qualification.objectName,
            contentType: file.type,
            cacheControl: '3600',
        },
        removeFingerprintOnSuccess: true,
        retryDelays: tusRetryDelaysMs,
        onError,
        onProgress(bytesUploaded, bytesTotal) {
            onProgress(bytesTotal > 0 ? (bytesUploaded / bytesTotal) * completeUploadPercentage : 0)
        },
        onSuccess,
    }
}
