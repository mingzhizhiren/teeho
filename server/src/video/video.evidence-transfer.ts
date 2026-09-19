import { createHash } from 'node:crypto'

import sharp from 'sharp'
import { z } from 'zod'

import { VIDEO_RULES } from '../config/constants'
import { logger } from '../utils/logger'
import { postgresVideoEvidenceTransferPersistence } from './video.evidence-transfer.repository'
import type { VideoAssetState } from './video.repository'
import { supabaseVideoEvidenceTransferStorage } from './video.storage'

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u)
const videoEvidenceManifestSchemaVersion = 'video-evidence-manifest.v1'
const jsonMediaType = 'application/json'
const webpMediaType = 'image/webp'
const framePositionWidth = 2
const DOWNLOAD_MAX_ATTEMPTS = 3
const DOWNLOAD_RETRY_DELAY_MS = 250
const DOWNLOAD_RETRY_HTTP = {
    timeout: 408,
    throttled: 429,
    serverError: 500,
    nextCategory: 600,
} as const

function isTransientDownloadError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false
    const details = error as {
        status?: unknown
        statusCode?: unknown
        name?: unknown
        code?: unknown
        message?: unknown
    }
    const status = Number(details.statusCode ?? details.status)
    if (Number.isFinite(status))
        return (
            status === DOWNLOAD_RETRY_HTTP.timeout ||
            status === DOWNLOAD_RETRY_HTTP.throttled ||
            (status >= DOWNLOAD_RETRY_HTTP.serverError && status < DOWNLOAD_RETRY_HTTP.nextCategory)
        )
    return (
        details.name === 'TimeoutError' ||
        /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|UND_ERR_SOCKET)$/u.test(String(details.code)) ||
        /socket connection.*closed|fetch failed|failed to fetch|network.*(error|failed)|timed?\s*out/iu.test(
            String(details.message),
        )
    )
}

/** 只重试失败帧的下载资格读取，不重传素材或重复提交诊断。 */
async function signedDownloadWithRetry(storage: VideoEvidenceTransferStorage, objectPath: string) {
    for (let attempt = 1; attempt <= DOWNLOAD_MAX_ATTEMPTS; attempt += 1) {
        try {
            return await storage.createSignedDownload(objectPath)
        } catch (error) {
            const retry = attempt < DOWNLOAD_MAX_ATTEMPTS && isTransientDownloadError(error)
            logger.warn(
                {
                    event: 'video_evidence_download_qualification_failed',
                    attempt,
                    retry,
                    errorName: error instanceof Error ? error.name : 'UnknownError',
                },
                '视频证据下载资格读取失败',
            )
            if (!retry) {
                throw new VideoEvidenceTransferError(
                    'VIDEO_EVIDENCE_DOWNLOAD_UNAVAILABLE',
                    '视频资料暂时读取失败，请重试。当前素材和草稿已保留。',
                )
            }
            await new Promise<void>((resolve) =>
                setTimeout(resolve, DOWNLOAD_RETRY_DELAY_MS * attempt),
            )
        }
    }
    throw new VideoEvidenceTransferError(
        'VIDEO_EVIDENCE_DOWNLOAD_UNAVAILABLE',
        '视频资料暂时读取失败，请重试。当前素材和草稿已保留。',
    )
}

const videoEvidenceManifestFrameSchema = z
    .object({
        position: z.number().int().nonnegative(),
        timestampMs: z.number().int().nonnegative(),
        selectionReason: z.string().trim().min(1).max(VIDEO_RULES.frameSelectionReasonMaxLength),
        sha256: sha256Schema,
        width: z.number().int().positive().max(VIDEO_RULES.frameMaximumEdgePixels),
        height: z.number().int().positive().max(VIDEO_RULES.frameMaximumEdgePixels),
        byteSize: z.number().int().positive(),
        mediaType: z.literal(webpMediaType),
    })
    .strict()

const videoEvidenceManifestWithoutDigestSchema = z
    .object({
        schemaVersion: z.literal(videoEvidenceManifestSchemaVersion),
        evidenceId: z.string().uuid(),
        evidenceVersion: z.string().min(1),
        originalSha256: sha256Schema,
        durationMs: z.number().int().positive().max(VIDEO_RULES.maximumDurationMs),
        width: z.number().int().positive().max(VIDEO_RULES.maximumEdgePixels),
        height: z.number().int().positive().max(VIDEO_RULES.maximumEdgePixels),
        container: z.string().trim().min(1).max(VIDEO_RULES.metadataLabelMaxLength),
        videoCodec: z.string().trim().min(1).max(VIDEO_RULES.metadataLabelMaxLength),
        hasAudio: z.boolean(),
        mediaMetadata: z.record(z.string(), z.unknown()),
        pipelineVersion: z.string().trim().min(1),
        pipelineConfigVersion: z.string().trim().min(1),
        ffmpegVersion: z.string().trim().min(1),
        generatedAt: z.string().datetime(),
        expiresAt: z.string().datetime(),
        frames: z.array(videoEvidenceManifestFrameSchema).min(1).max(VIDEO_RULES.maximumFrames),
    })
    .strict()

/** 视频证据清单的运行时校验模式。 */
export const videoEvidenceManifestSchema = videoEvidenceManifestWithoutDigestSchema
    .extend({ packageSha256: sha256Schema })
    .strict()

/** 视频证据清单。 */
export type VideoEvidenceManifest = z.infer<typeof videoEvidenceManifestSchema>

/** 账号拥有的视频证据传输帧。 */
export interface OwnedVideoEvidenceTransferFrame {
    position: number
    timestampMs: number
    selectionReason: string
    objectPath: string
    sha256: string
    width: number
    height: number
    byteSize: number
    mediaType: 'image/webp'
}

/** 认证下载和本地恢复所需的服务端权威证据投影。 */
export interface OwnedVideoEvidenceTransferRecord {
    assetId: string
    userId: string
    assetState: VideoAssetState
    evidenceId: string
    evidenceVersion: string
    originalSha256: string
    durationMs: number
    width: number
    height: number
    container: string
    videoCodec: string
    hasAudio: boolean
    mediaMetadata: Record<string, unknown>
    pipelineVersion: string
    pipelineConfigVersion: string
    ffmpegVersion: string
    manifestObjectPath: string
    generatedAt: string
    expiresAt: string
    cleanupState: 'retained' | 'deleting' | 'deleted' | 'cleanup_failed'
    frames: OwnedVideoEvidenceTransferFrame[]
}

/** 视频证据恢复会话记录。 */
export interface VideoEvidenceRestoreSessionRecord {
    sessionId: string
    evidenceId: string
    state: 'issued' | 'completed' | 'failed' | 'expired'
    manifestObjectPath: string
    frameObjectPaths: string[]
    expiresAt: string
}

/** 视频证据传输持久化边界。 */
export interface VideoEvidenceTransferPersistence {
    findOwned(userId: string, videoId: string): Promise<OwnedVideoEvidenceTransferRecord | null>
    beginRestore(input: {
        sessionId: string
        userId: string
        videoId: string
        evidenceId: string
        manifestObjectPath: string
        frameObjectPaths: string[]
        expiresAt: string
    }): Promise<VideoEvidenceRestoreSessionRecord>
    findRestore(
        userId: string,
        videoId: string,
        sessionId: string,
    ): Promise<VideoEvidenceRestoreSessionRecord | null>
    completeRestore(
        userId: string,
        sessionId: string,
        replacement: {
            manifestObjectPath: string
            frameObjectPaths: string[]
            expiresAt: string
        },
    ): Promise<boolean>
    failRestore(userId: string, sessionId: string, errorCode: string): Promise<void>
}

/** 视频证据传输对象存储边界。 */
export interface VideoEvidenceTransferStorage {
    createSignedDownload(path: string): Promise<{ url: string; expiresAt: string }>
    createSignedUpload(path: string): Promise<{ url: string; token: string }>
    info(path: string): Promise<{ size: number | null; contentType: string | null } | null>
    download(path: string): Promise<Uint8Array>
    remove(paths: string[]): Promise<void>
}

interface VideoEvidenceTransferClock {
    now: () => Date
    randomUUID: () => string
}

/** 视频证据传输错误。 */
export class VideoEvidenceTransferError extends Error {
    constructor(
        readonly code:
            | 'VIDEO_EVIDENCE_NOT_FOUND'
            | 'VIDEO_EVIDENCE_DOWNLOAD_UNAVAILABLE'
            | 'VIDEO_EVIDENCE_EXPIRED'
            | 'VIDEO_EVIDENCE_NOT_EXPIRED'
            | 'VIDEO_EVIDENCE_RESTORE_PENDING'
            | 'VIDEO_EVIDENCE_VERSION_UNSUPPORTED'
            | 'VIDEO_EVIDENCE_RESTORE_INVALID'
            | 'VIDEO_EVIDENCE_RESTORE_EXPIRED',
        message: string,
    ) {
        super(message)
        this.name = 'VideoEvidenceTransferError'
    }
}

function packageDigestInput(manifest: Omit<VideoEvidenceManifest, 'packageSha256'>) {
    return {
        schemaVersion: manifest.schemaVersion,
        evidenceId: manifest.evidenceId,
        evidenceVersion: manifest.evidenceVersion,
        originalSha256: manifest.originalSha256,
        durationMs: manifest.durationMs,
        width: manifest.width,
        height: manifest.height,
        container: manifest.container,
        videoCodec: manifest.videoCodec,
        hasAudio: manifest.hasAudio,
        mediaMetadata: manifest.mediaMetadata,
        pipelineVersion: manifest.pipelineVersion,
        pipelineConfigVersion: manifest.pipelineConfigVersion,
        ffmpegVersion: manifest.ffmpegVersion,
        generatedAt: manifest.generatedAt,
        frames: manifest.frames,
    }
}

function stableValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(stableValue)
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, item]) => [key, stableValue(item)]),
        )
    }
    return value
}

function calculatePackageSha256(manifest: Omit<VideoEvidenceManifest, 'packageSha256'>) {
    return createHash('sha256')
        .update(JSON.stringify(stableValue(packageDigestInput(manifest))))
        .digest('hex')
}

/** 从数据库权威记录生成不含任何对象路径的可移植证据清单。 */
export function createVideoEvidenceManifest(
    evidence: OwnedVideoEvidenceTransferRecord,
): VideoEvidenceManifest {
    const withoutDigest = videoEvidenceManifestWithoutDigestSchema.parse({
        schemaVersion: videoEvidenceManifestSchemaVersion,
        evidenceId: evidence.evidenceId,
        evidenceVersion: evidence.evidenceVersion,
        originalSha256: evidence.originalSha256,
        durationMs: evidence.durationMs,
        width: evidence.width,
        height: evidence.height,
        container: evidence.container,
        videoCodec: evidence.videoCodec,
        hasAudio: evidence.hasAudio,
        mediaMetadata: evidence.mediaMetadata,
        pipelineVersion: evidence.pipelineVersion,
        pipelineConfigVersion: evidence.pipelineConfigVersion,
        ffmpegVersion: evidence.ffmpegVersion,
        generatedAt: evidence.generatedAt,
        expiresAt: evidence.expiresAt,
        frames: evidence.frames.map((frame) => ({
            position: frame.position,
            timestampMs: frame.timestampMs,
            selectionReason: frame.selectionReason,
            sha256: frame.sha256,
            width: frame.width,
            height: frame.height,
            byteSize: frame.byteSize,
            mediaType: frame.mediaType,
        })),
    })
    return {
        ...withoutDigest,
        packageSha256: calculatePackageSha256(withoutDigest),
    }
}

/** 清单对象使用稳定字段顺序序列化，供浏览器直传和服务端完整复核。 */
export function serializeVideoEvidenceManifest(manifest: VideoEvidenceManifest) {
    return new TextEncoder().encode(JSON.stringify(videoEvidenceManifestSchema.parse(manifest)))
}

function hasSupportedVersion(manifest: VideoEvidenceManifest) {
    return (
        manifest.evidenceVersion === VIDEO_RULES.evidenceVersion &&
        manifest.pipelineVersion === VIDEO_RULES.pipelineVersion &&
        manifest.pipelineConfigVersion === VIDEO_RULES.pipelineConfigVersion
    )
}

function sameImmutableManifest(left: VideoEvidenceManifest, right: VideoEvidenceManifest) {
    return (
        JSON.stringify(stableValue(packageDigestInput(left))) ===
        JSON.stringify(stableValue(packageDigestInput(right)))
    )
}

function parseRestoreManifest(value: unknown, expected: OwnedVideoEvidenceTransferRecord) {
    const parsed = videoEvidenceManifestSchema.safeParse(value)
    if (!parsed.success || !hasSupportedVersion(parsed.data)) {
        throw new VideoEvidenceTransferError(
            'VIDEO_EVIDENCE_VERSION_UNSUPPORTED',
            '本地视频证据版本已不受支持，请重新上传原视频',
        )
    }
    const expectedManifest = createVideoEvidenceManifest(expected)
    if (
        parsed.data.packageSha256 !== calculatePackageSha256(parsed.data) ||
        parsed.data.packageSha256 !== expectedManifest.packageSha256 ||
        !sameImmutableManifest(parsed.data, expectedManifest)
    ) {
        throw new VideoEvidenceTransferError(
            'VIDEO_EVIDENCE_RESTORE_INVALID',
            '本地视频证据已损坏，请重新上传原视频',
        )
    }
    return parsed.data
}

function isExpired(expiresAt: string, now: Date) {
    return Date.parse(expiresAt) <= now.getTime()
}

function assertCurrentEvidence(evidence: OwnedVideoEvidenceTransferRecord, now: Date) {
    const manifest = createVideoEvidenceManifest(evidence)
    if (!hasSupportedVersion(manifest)) {
        throw new VideoEvidenceTransferError(
            'VIDEO_EVIDENCE_VERSION_UNSUPPORTED',
            '视频证据版本已不受支持，请重新上传原视频',
        )
    }
    if (
        evidence.assetState !== 'ready' ||
        evidence.cleanupState !== 'retained' ||
        isExpired(evidence.expiresAt, now)
    ) {
        throw new VideoEvidenceTransferError('VIDEO_EVIDENCE_EXPIRED', '视频证据已超过云端保存时间')
    }
    return manifest
}

function restoreBasePath(userId: string, sessionId: string) {
    return `${userId}/restored-evidence/${sessionId}`
}

function frameRestorePath(basePath: string, position: number) {
    return `${basePath}/frames/${position.toString().padStart(framePositionWidth, '0')}.webp`
}

async function validateRestoredFrame(
    content: Uint8Array,
    frame: VideoEvidenceManifest['frames'][number],
) {
    if (content.byteLength !== frame.byteSize) {
        return false
    }
    const digest = createHash('sha256').update(content).digest('hex')
    if (digest !== frame.sha256) {
        return false
    }
    try {
        const metadata = await sharp(content).metadata()
        return (
            metadata.format === 'webp' &&
            metadata.width === frame.width &&
            metadata.height === frame.height
        )
    } catch {
        return false
    }
}

/** 创建认证证据下载与本地证据恢复服务。 */
export function createVideoEvidenceTransferService(options: {
    persistence: VideoEvidenceTransferPersistence
    storage: VideoEvidenceTransferStorage
    clock: VideoEvidenceTransferClock
}) {
    const { persistence, storage, clock } = options

    async function ownedEvidence(userId: string, videoId: string) {
        const evidence = await persistence.findOwned(userId, videoId)
        if (!evidence) {
            throw new VideoEvidenceTransferError('VIDEO_EVIDENCE_NOT_FOUND', '视频证据不存在')
        }
        return evidence
    }

    return {
        /** 只对仍在云端保留期内的当前版本证据签发短期关键帧下载资格。 */
        async getDownload(userId: string, videoId: string) {
            const evidence = await ownedEvidence(userId, videoId)
            const manifest = assertCurrentEvidence(evidence, clock.now())
            const qualifications = await Promise.all(
                evidence.frames.map((frame) => signedDownloadWithRetry(storage, frame.objectPath)),
            )
            return {
                manifest,
                frames: qualifications.map((qualification, index) => ({
                    position: evidence.frames[index]!.position,
                    downloadUrl: qualification.url,
                    expiresAt: qualification.expiresAt,
                })),
            }
        },

        /** 对已过期的同版本证据签发新的私有对象直传位置。 */
        async createRestoreSession(userId: string, videoId: string, manifestInput: unknown) {
            const evidence = await ownedEvidence(userId, videoId)
            const manifest = parseRestoreManifest(manifestInput, evidence)
            if (!isExpired(evidence.expiresAt, clock.now())) {
                throw new VideoEvidenceTransferError(
                    'VIDEO_EVIDENCE_NOT_EXPIRED',
                    '云端视频证据仍可直接复用',
                )
            }
            if (evidence.cleanupState !== 'deleted') {
                throw new VideoEvidenceTransferError(
                    'VIDEO_EVIDENCE_RESTORE_PENDING',
                    '云端视频证据正在清理，请稍后重试',
                )
            }
            const sessionId = clock.randomUUID()
            const basePath = restoreBasePath(userId, sessionId)
            const expiresAt = new Date(
                clock.now().getTime() + VIDEO_RULES.signedUploadLifetimeMs,
            ).toISOString()
            const session = await persistence.beginRestore({
                sessionId,
                userId,
                videoId,
                evidenceId: evidence.evidenceId,
                manifestObjectPath: `${basePath}/manifest.json`,
                frameObjectPaths: manifest.frames.map((frame) =>
                    frameRestorePath(basePath, frame.position),
                ),
                expiresAt,
            })
            const [manifestUpload, ...frameUploads] = await Promise.all([
                storage.createSignedUpload(session.manifestObjectPath),
                ...session.frameObjectPaths.map((path) => storage.createSignedUpload(path)),
            ])
            return {
                sessionId: session.sessionId,
                evidenceId: session.evidenceId,
                expiresAt: session.expiresAt,
                manifest: {
                    uploadUrl: manifestUpload!.url,
                    token: manifestUpload!.token,
                },
                frames: frameUploads.map((upload, index) => ({
                    position: manifest.frames[index]!.position,
                    uploadUrl: upload.url,
                    token: upload.token,
                })),
            }
        },

        /** 下载浏览器直传对象并重新执行全部结构、字节、尺寸和摘要校验。 */
        async confirmRestore(userId: string, videoId: string, sessionId: string) {
            const [evidence, session] = await Promise.all([
                ownedEvidence(userId, videoId),
                persistence.findRestore(userId, videoId, sessionId),
            ])
            if (
                !session ||
                session.state !== 'issued' ||
                isExpired(session.expiresAt, clock.now())
            ) {
                throw new VideoEvidenceTransferError(
                    'VIDEO_EVIDENCE_RESTORE_EXPIRED',
                    '本地视频证据恢复资格已过期',
                )
            }

            let failureCode = 'restore_validation_failed'
            try {
                const manifestInfo = await storage.info(session.manifestObjectPath)
                if (!manifestInfo || manifestInfo.contentType !== jsonMediaType) {
                    failureCode = 'manifest_object_mismatch'
                    throw new Error(failureCode)
                }
                const manifestBytes = await storage.download(session.manifestObjectPath)
                const manifest = parseRestoreManifest(
                    JSON.parse(new TextDecoder().decode(manifestBytes)) as unknown,
                    evidence,
                )
                if (
                    manifest.frames.length !== session.frameObjectPaths.length ||
                    manifest.frames.some((frame, index) => frame.position !== index)
                ) {
                    failureCode = 'manifest_frame_mismatch'
                    throw new Error(failureCode)
                }
                for (const [index, frame] of manifest.frames.entries()) {
                    const objectPath = session.frameObjectPaths[index]!
                    const info = await storage.info(objectPath)
                    if (
                        !info ||
                        info.contentType !== webpMediaType ||
                        info.size !== frame.byteSize
                    ) {
                        failureCode = 'frame_object_mismatch'
                        throw new Error(failureCode)
                    }
                    const content = await storage.download(objectPath)
                    if (!(await validateRestoredFrame(content, frame))) {
                        failureCode = 'frame_integrity_mismatch'
                        throw new Error(failureCode)
                    }
                }
                const expiresAt = new Date(
                    clock.now().getTime() + VIDEO_RULES.evidenceRetentionMs,
                ).toISOString()
                const completed = await persistence.completeRestore(userId, sessionId, {
                    manifestObjectPath: session.manifestObjectPath,
                    frameObjectPaths: session.frameObjectPaths,
                    expiresAt,
                })
                if (!completed) {
                    throw new VideoEvidenceTransferError(
                        'VIDEO_EVIDENCE_RESTORE_EXPIRED',
                        '本地视频证据恢复状态已改变',
                    )
                }
                return {
                    videoId,
                    evidenceId: evidence.evidenceId,
                    evidenceVersion: VIDEO_RULES.evidenceVersion,
                    expiresAt,
                }
            } catch (error) {
                if (error instanceof VideoEvidenceTransferError) {
                    failureCode =
                        error.code === 'VIDEO_EVIDENCE_VERSION_UNSUPPORTED'
                            ? 'version_unsupported'
                            : 'manifest_integrity_mismatch'
                }
                await persistence.failRestore(userId, sessionId, failureCode)
                await storage
                    .remove([session.manifestObjectPath, ...session.frameObjectPaths])
                    .catch(() => undefined)
                if (error instanceof VideoEvidenceTransferError) {
                    throw error
                }
                throw new VideoEvidenceTransferError(
                    'VIDEO_EVIDENCE_RESTORE_INVALID',
                    '本地视频证据已损坏，请重新上传原视频',
                )
            }
        },
    }
}

/** 生产环境认证视频证据传输服务。 */
export const videoEvidenceTransferService = createVideoEvidenceTransferService({
    persistence: postgresVideoEvidenceTransferPersistence,
    storage: supabaseVideoEvidenceTransferStorage,
    clock: {
        now: () => new Date(),
        randomUUID: () => crypto.randomUUID(),
    },
})
