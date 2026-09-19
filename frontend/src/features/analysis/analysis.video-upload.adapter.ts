import { Upload } from 'tus-js-client'

import {
    cancelAnalysisVideo,
    confirmAnalysisVideoUpload,
    createAnalysisVideoUploadSession,
    getAnalysisVideoStatus,
    resumeAnalysisVideoUploadSession,
} from '@/api/analysis'
import type {
    AnalysisVideoTransport,
    AnalysisVideoUploadQualification,
} from './analysis.video-upload'
import {
    createStandardSignedUploadUrl,
    createTusUploadOptions,
    isSignedTusCompatibilityError,
    readTusUploadDebugFields,
} from './analysis.tus'

const successfulHttpStatusMinimum = 200
const successfulHttpStatusMaximumExclusive = 300
const completeUploadPercentage = 100
const signedUploadCacheSeconds = 3_600

function debugVideoUpload(event: string, fields: Record<string, unknown>) {
    if (!import.meta.env.DEV) {
        return
    }
    console.debug('[video-upload]', { event, ...fields })
}

class StandardSignedUploadError extends Error {
    constructor(
        readonly httpStatus: number,
        readonly responseBodyLength: number,
    ) {
        super('Standard signed video upload failed')
        this.name = 'StandardSignedUploadError'
    }
}

function uploadWithTus(
    qualification: AnalysisVideoUploadQualification,
    file: File,
    onProgress: (percentage: number) => void,
    signal: AbortSignal,
) {
    return new Promise<void>((resolve, reject) => {
        const startedAt = performance.now()
        let settled = false
        const settle = (callback: () => void) => {
            if (settled) {
                return
            }
            settled = true
            signal.removeEventListener('abort', abort)
            callback()
        }
        const upload = new Upload(
            file,
            createTusUploadOptions(
                qualification,
                file,
                onProgress,
                () =>
                    settle(() => {
                        debugVideoUpload('video_tus_upload_completed', {
                            byteSize: file.size,
                            mediaType: file.type,
                            durationMs: Math.round(performance.now() - startedAt),
                        })
                        resolve()
                    }),
                (error) =>
                    settle(() => {
                        debugVideoUpload('video_tus_upload_failed', {
                            byteSize: file.size,
                            mediaType: file.type,
                            durationMs: Math.round(performance.now() - startedAt),
                            ...readTusUploadDebugFields(error),
                        })
                        reject(error)
                    }),
            ),
        )
        const abort = () => {
            void upload.abort().finally(() => {
                settle(() => reject(new DOMException('Upload aborted', 'AbortError')))
            })
        }
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) {
            abort()
            return
        }
        debugVideoUpload('video_tus_upload_started', {
            byteSize: file.size,
            mediaType: file.type,
            bucketName: qualification.bucketName,
        })
        void upload
            .findPreviousUploads()
            .then((previousUploads) => {
                if (signal.aborted || settled) {
                    return
                }
                const previous = previousUploads[0]
                debugVideoUpload('video_tus_resume_checked', {
                    previousUploadCount: previousUploads.length,
                    resumed: Boolean(previous),
                })
                if (previous) {
                    upload.resumeFromPreviousUpload(previous)
                }
                upload.start()
            })
            .catch((error: unknown) => {
                settle(() => {
                    debugVideoUpload('video_tus_resume_lookup_failed', {
                        ...readTusUploadDebugFields(error),
                    })
                    reject(error)
                })
            })
    })
}

function uploadWithStandardSignedPut(
    qualification: AnalysisVideoUploadQualification,
    file: File,
    onProgress: (percentage: number) => void,
    signal: AbortSignal,
) {
    return new Promise<void>((resolve, reject) => {
        const startedAt = performance.now()
        const request = new XMLHttpRequest()
        let settled = false
        const settle = (callback: () => void) => {
            if (settled) {
                return
            }
            settled = true
            signal.removeEventListener('abort', abort)
            callback()
        }
        const fail = () => {
            const error = new StandardSignedUploadError(request.status, request.responseText.length)
            debugVideoUpload('video_signed_put_failed', {
                byteSize: file.size,
                mediaType: file.type,
                durationMs: Math.round(performance.now() - startedAt),
                errorName: error.name,
                httpStatus: error.httpStatus,
                responseBodyLength: error.responseBodyLength,
            })
            settle(() => reject(error))
        }
        const abort = () => {
            request.abort()
            settle(() => reject(new DOMException('Upload aborted', 'AbortError')))
        }

        request.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable && event.total > 0) {
                onProgress((event.loaded / event.total) * completeUploadPercentage)
            }
        })
        request.addEventListener('load', () => {
            if (
                request.status < successfulHttpStatusMinimum ||
                request.status >= successfulHttpStatusMaximumExclusive
            ) {
                fail()
                return
            }
            debugVideoUpload('video_signed_put_completed', {
                byteSize: file.size,
                mediaType: file.type,
                durationMs: Math.round(performance.now() - startedAt),
                httpStatus: request.status,
            })
            settle(resolve)
        })
        request.addEventListener('error', fail)
        request.addEventListener('abort', () =>
            settle(() => reject(new DOMException('Upload aborted', 'AbortError'))),
        )
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) {
            abort()
            return
        }

        request.open('PUT', createStandardSignedUploadUrl(qualification))
        request.setRequestHeader('cache-control', `max-age=${signedUploadCacheSeconds}`)
        request.setRequestHeader('content-type', file.type)
        request.setRequestHeader('x-upsert', 'false')
        debugVideoUpload('video_signed_put_started', {
            byteSize: file.size,
            mediaType: file.type,
            bucketName: qualification.bucketName,
        })
        request.send(file)
    })
}

/** 浏览器生产适配器：优先 TUS 直传；签名 TUS 不兼容时回退到标准签名 PUT。 */
export const browserAnalysisVideoTransport: AnalysisVideoTransport = {
    createSession: createAnalysisVideoUploadSession,
    resumeSession: resumeAnalysisVideoUploadSession,

    async directUpload(qualification, file, onProgress, signal) {
        try {
            await uploadWithTus(qualification, file, onProgress, signal)
        } catch (error) {
            if (!isSignedTusCompatibilityError(error)) {
                throw error
            }
            debugVideoUpload('video_tus_fallback_to_signed_put', {
                ...readTusUploadDebugFields(error),
            })
            await uploadWithStandardSignedPut(qualification, file, onProgress, signal)
        }
    },

    confirm: confirmAnalysisVideoUpload,
    status: getAnalysisVideoStatus,
    cancel: cancelAnalysisVideo,
}

export {
    createStandardSignedUploadUrl,
    createTusUploadOptions,
    isSignedTusCompatibilityError,
} from './analysis.tus'
