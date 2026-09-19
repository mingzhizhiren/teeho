import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { createClient } from '@supabase/supabase-js'

import { HTTP_STATUS, VIDEO_RULES } from '../config/constants'
import { env } from '../config/env'
import type { VideoEvidenceTransferStorage } from './video.evidence-transfer'

const signedDownloadLifetimeSeconds = 60
const millisecondsPerSecond = 1_000

/** 对象存储中的视频对象信息。 */
export interface VideoObjectInfo {
    size: number | null
    contentType: string | null
}

/** 大文件对象存储边界；上传由浏览器 TUS 直传，Worker 下载到受控临时文件。 */
export interface VideoObjectStorage {
    createSignedUpload(path: string): Promise<{ signature: string }>
    info(path: string): Promise<VideoObjectInfo | null>
    downloadToFile(path: string, destinationPath: string, signal?: AbortSignal): Promise<void>
    upload(path: string, content: Uint8Array, mediaType: string): Promise<void>
    remove(paths: string[]): Promise<void>
}

function createStorageClient() {
    if (!env.SUPABASE_SECRET_KEY) {
        throw new Error('SUPABASE_SECRET_KEY 未配置，无法访问私有视频对象')
    }
    return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
        auth: {
            autoRefreshToken: false,
            detectSessionInUrl: false,
            persistSession: false,
        },
    }).storage.from(VIDEO_RULES.storageBucket)
}

/** 下载较小的派生证据对象；原视频仍只允许流式下载到临时文件。 */
export async function downloadVideoEvidenceObject(path: string) {
    return supabaseVideoEvidenceTransferStorage.download(path)
}

function objectSize(data: Record<string, unknown>) {
    const metadata = data.metadata as Record<string, unknown> | null
    if (typeof metadata?.size === 'number') {
        return metadata.size
    }
    return typeof data.size === 'number' ? data.size : null
}

function objectContentType(data: Record<string, unknown>) {
    const metadata = data.metadata as Record<string, unknown> | null
    if (typeof metadata?.mimetype === 'string') {
        return metadata.mimetype
    }
    return typeof data.contentType === 'string' ? data.contentType : null
}

/** Supabase Storage 生产适配器。签名只返回给已通过后端资格检查的账号。 */
export const supabaseVideoObjectStorage: VideoObjectStorage = {
    async createSignedUpload(path) {
        const { data, error } = await createStorageClient().createSignedUploadUrl(path, {
            upsert: false,
        })
        if (error || !data?.token) {
            throw error ?? new Error('Storage 未返回 TUS 上传签名')
        }
        return { signature: data.token }
    },

    async info(path) {
        const { data, error } = await createStorageClient().info(path)
        if (error) {
            if ('status' in error && error.status === HTTP_STATUS.NOT_FOUND) {
                return null
            }
            throw error
        }
        const object = data as unknown as Record<string, unknown>
        return {
            size: objectSize(object),
            contentType: objectContentType(object),
        }
    },

    async downloadToFile(path, destinationPath, signal) {
        const { data, error } = await createStorageClient().createSignedUrl(
            path,
            signedDownloadLifetimeSeconds,
        )
        if (error || !data?.signedUrl) {
            throw error ?? new Error('Storage 未返回视频下载资格')
        }
        const timeoutSignal = AbortSignal.timeout(VIDEO_RULES.storageDownloadTimeoutMs)
        const response = await fetch(data.signedUrl, {
            signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
        })
        if (!response.ok || !response.body) {
            throw new Error(`下载私有视频失败：HTTP ${response.status}`)
        }
        await pipeline(
            Readable.fromWeb(response.body as never),
            createWriteStream(destinationPath, { flags: 'wx' }),
        )
    },

    async upload(path, content, mediaType) {
        const { error } = await createStorageClient().upload(path, content, {
            contentType: mediaType,
            upsert: false,
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

/** 小型视频证据对象的私有下载、浏览器恢复直传和服务端复核适配器。 */
export const supabaseVideoEvidenceTransferStorage: VideoEvidenceTransferStorage = {
    async createSignedDownload(path) {
        const { data, error } = await createStorageClient().createSignedUrl(
            path,
            signedDownloadLifetimeSeconds,
        )
        if (error || !data?.signedUrl) {
            throw error ?? new Error('Storage 未返回视频证据下载资格')
        }
        return {
            url: data.signedUrl,
            expiresAt: new Date(
                Date.now() + signedDownloadLifetimeSeconds * millisecondsPerSecond,
            ).toISOString(),
        }
    },

    async createSignedUpload(path) {
        const { data, error } = await createStorageClient().createSignedUploadUrl(path, {
            upsert: false,
        })
        if (error || !data?.signedUrl || !data.token) {
            throw error ?? new Error('Storage 未返回视频证据恢复资格')
        }
        return { url: data.signedUrl, token: data.token }
    },

    async info(path) {
        return supabaseVideoObjectStorage.info(path)
    },

    async download(path) {
        const { data, error } = await createStorageClient().download(path)
        if (error || !data) {
            throw error ?? new Error('视频证据对象下载失败')
        }
        return new Uint8Array(await data.arrayBuffer())
    },

    async remove(paths) {
        return supabaseVideoObjectStorage.remove(paths)
    },
}

/** 将 Supabase 项目 URL 转换为官方建议的 Storage 直连 TUS 端点。 */
export function createVideoTusEndpoint(supabaseUrl: string) {
    const url = new URL(supabaseUrl)
    if (url.hostname.endsWith('.supabase.co')) {
        const projectRef = url.hostname.slice(0, -'.supabase.co'.length)
        return `${url.protocol}//${projectRef}.storage.supabase.co/storage/v1/upload/resumable`
    }
    return `${url.origin}/storage/v1/upload/resumable`
}
