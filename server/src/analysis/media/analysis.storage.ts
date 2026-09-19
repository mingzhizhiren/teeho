import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'

import { HTTP_STATUS } from '../../config/constants'
import { env } from '../../config/env'
import { logger } from '../../utils/logger'
import { analysisMediaConstraints } from '../analysis.constants'

export interface AnalysisObjectInfo {
    size: number | null
    contentType: string | null
}

/** 对象存储边界；业务层只持有不公开的对象键，不依赖厂商消息格式。 */
export interface AnalysisObjectStorage {
    createSignedUpload(path: string): Promise<{ signedUrl: string; token: string }>
    info(path: string): Promise<AnalysisObjectInfo | null>
    download(path: string): Promise<Uint8Array>
    upload(path: string, content: Uint8Array, mediaType: string): Promise<void>
    remove(paths: string[]): Promise<void>
}

interface DownloadTrace {
    downloadId: string
    objectKeyHash: string
}

function safeResponseId(value: string | null): string | null {
    return value && /^[a-zA-Z0-9_:.-]{1,128}$/u.test(value) ? value : null
}

function createStorageClient(trace?: DownloadTrace) {
    if (!env.SUPABASE_SECRET_KEY) {
        throw new Error('SUPABASE_SECRET_KEY 未配置，无法访问私有分析图片')
    }
    return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
        ...(trace
            ? {
                  global: {
                      fetch: Object.assign(
                          async (
                              input: Parameters<typeof fetch>[0],
                              init?: Parameters<typeof fetch>[1],
                          ) => {
                              const startedAt = performance.now()
                              const response = await fetch(input, init)
                              const fields = {
                                  event: 'analysis_storage_download_http',
                                  ...trace,
                                  status: response.status,
                                  durationMs: Math.round(performance.now() - startedAt),
                                  upstreamRequestId: safeResponseId(
                                      response.headers.get('sb-request-id'),
                                  ),
                                  upstreamTraceId: safeResponseId(
                                      response.headers.get('x-request-id'),
                                  ),
                                  edgeRequestId: safeResponseId(response.headers.get('cf-ray')),
                              }
                              if (response.ok) logger.debug(fields, '图片存储读取响应')
                              else logger.debug(fields, '图片存储读取被拒绝或失败')
                              return response
                          },
                          { preconnect: fetch.preconnect },
                      ),
                  },
              }
            : {}),
        auth: {
            autoRefreshToken: false,
            detectSessionInUrl: false,
            persistSession: false,
        },
    }).storage.from(analysisMediaConstraints.storageBucket)
}

/** Supabase Storage 生产适配器。 */
export const supabaseAnalysisObjectStorage: AnalysisObjectStorage = {
    async createSignedUpload(path) {
        const { data, error } = await createStorageClient().createSignedUploadUrl(path, {
            upsert: false,
        })
        if (error || !data?.signedUrl || !data.token) {
            throw error ?? new Error('Storage 未返回上传资格')
        }
        return { signedUrl: data.signedUrl, token: data.token }
    },

    async info(path) {
        const { data, error } = await createStorageClient().info(path)
        if (error) {
            if ('status' in error && error.status === HTTP_STATUS.NOT_FOUND) {
                return null
            }
            return null
        }
        const metadata = data.metadata as Record<string, unknown> | null
        return {
            size:
                typeof metadata?.size === 'number'
                    ? metadata.size
                    : typeof data.size === 'number'
                      ? data.size
                      : null,
            contentType:
                typeof metadata?.mimetype === 'string'
                    ? metadata.mimetype
                    : typeof data.contentType === 'string'
                      ? data.contentType
                      : null,
        }
    },

    async download(path) {
        const trace = {
            downloadId: crypto.randomUUID(),
            objectKeyHash: createHash('sha256').update(path).digest('hex'),
        }
        const startedAt = performance.now()
        logger.debug({ event: 'analysis_storage_download_started', ...trace }, '开始读取图片存储')
        try {
            const { data, error } = await createStorageClient(trace).download(path)
            if (error || !data) throw error ?? new Error('读取私有图片失败')
            const content = new Uint8Array(await data.arrayBuffer())
            logger.debug(
                {
                    event: 'analysis_storage_download_completed',
                    ...trace,
                    durationMs: Math.round(performance.now() - startedAt),
                    byteSize: content.byteLength,
                },
                '图片存储读取完成',
            )
            return content
        } catch (error) {
            logger.debug(
                {
                    event: 'analysis_storage_download_failed',
                    ...trace,
                    durationMs: Math.round(performance.now() - startedAt),
                    errorName: error instanceof Error ? safeResponseId(error.name) : null,
                },
                '图片存储读取失败，保留原错误返回',
            )
            throw error
        }
    },

    async upload(path, content, mediaType) {
        const { error } = await createStorageClient().upload(path, content, {
            contentType: mediaType,
            upsert: true,
        })
        if (error) {
            throw error
        }
    },

    async remove(paths) {
        if (paths.length === 0) {
            return
        }
        const { error } = await createStorageClient().remove(paths)
        if (error) {
            throw error
        }
    },
}
