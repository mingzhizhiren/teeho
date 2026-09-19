import { z, type ZodType } from 'zod'

import { IndexedDbFileManager, type LocalFileMetadata } from '@/utils/indexedDbFiles'
import type { InsufficientStorageChoice, StorageCapacity } from './storageCapacity'

const localVideoEvidenceSchemaVersion = 1
const manifestSchemaVersion = 'video-evidence-manifest.v1'
const evidenceVersion = 'video-evidence.v1'
const pipelineVersion = 'ffmpeg-keyframes.v4'
const pipelineConfigVersion = 'video-preprocessing.v3'
const localEvidenceRecordPrefix = 'analysis-video-evidence'
const maximumFrames = 50
const maximumFrameEdgePixels = 1_024
const selectionReasonMaxLength = 100
const metadataLabelMaxLength = 50
const encryptedStorageSafetyFactor = 1.15
const localEvidenceMetadataKibibytes = 32
const bytesPerKibibyte = 1_024
const localEvidenceMetadataBytes = localEvidenceMetadataKibibytes * bytesPerKibibyte
const hexadecimalRadix = 16
const hexadecimalByteWidth = 2

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u)
const localFileMetadataSchema: ZodType<LocalFileMetadata> = z.object({
    id: z.string().min(1),
    name: z.string(),
    type: z.string(),
    size: z.number().int().nonnegative(),
    lastModified: z.number().int().nonnegative(),
    createdAt: z.number().int().nonnegative(),
})

const videoEvidenceManifestFrameSchema = z
    .object({
        position: z.number().int().nonnegative(),
        timestampMs: z.number().int().nonnegative(),
        selectionReason: z.string().trim().min(1).max(selectionReasonMaxLength),
        sha256: sha256Schema,
        width: z.number().int().positive().max(maximumFrameEdgePixels),
        height: z.number().int().positive().max(maximumFrameEdgePixels),
        byteSize: z.number().int().positive(),
        mediaType: z.literal('image/webp'),
    })
    .strict()

/** 视频证据清单的运行时校验模式。 */
export const videoEvidenceManifestSchema = z
    .object({
        schemaVersion: z.literal(manifestSchemaVersion),
        evidenceId: z.string().uuid(),
        evidenceVersion: z.literal(evidenceVersion),
        originalSha256: sha256Schema,
        durationMs: z.number().int().positive(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        container: z.string().trim().min(1).max(metadataLabelMaxLength),
        videoCodec: z.string().trim().min(1).max(metadataLabelMaxLength),
        hasAudio: z.boolean(),
        mediaMetadata: z.record(z.string(), z.unknown()),
        pipelineVersion: z.literal(pipelineVersion),
        pipelineConfigVersion: z.literal(pipelineConfigVersion),
        ffmpegVersion: z.string().trim().min(1),
        generatedAt: z.string().datetime(),
        expiresAt: z.string().datetime(),
        packageSha256: sha256Schema,
        frames: z.array(videoEvidenceManifestFrameSchema).min(1).max(maximumFrames),
    })
    .strict()

/** 视频证据清单。 */
export type VideoEvidenceManifest = z.infer<typeof videoEvidenceManifestSchema>

const localVideoEvidenceRecordSchema = z
    .object({
        schemaVersion: z.literal(localVideoEvidenceSchemaVersion),
        evidenceId: z.string().uuid(),
        savedAt: z.string().datetime(),
        manifest: videoEvidenceManifestSchema,
        frames: z.array(localFileMetadataSchema).min(1).max(maximumFrames),
    })
    .strict()

/** 浏览器本地视频证据存储边界。 */
export interface LocalVideoEvidenceStorage {
    saveRecord<T>(id: string, value: T): Promise<void>
    getRecord<T>(id: string, schema: ZodType<T>): Promise<T | null>
    deleteRecord(id: string): Promise<void>
    saveFile(file: File, id?: string): Promise<LocalFileMetadata>
    getFile(id: string): Promise<{ metadata: LocalFileMetadata; content: Blob } | null>
    deleteFile(id: string): Promise<void>
}

/** 视频证据下载包的运行时校验模式。 */
export const videoEvidenceDownloadBundleSchema = z.object({
    manifest: videoEvidenceManifestSchema,
    frames: z.array(
        z.object({
            position: z.number().int().nonnegative(),
            downloadUrl: z.string().url(),
            expiresAt: z.string().datetime(),
        }),
    ),
})
/** 视频证据下载包。 */
export type VideoEvidenceDownloadBundle = z.infer<typeof videoEvidenceDownloadBundleSchema>

/** 视频证据下载响应的运行时校验模式。 */
export const videoEvidenceDownloadDataSchema = z.object({
    bundle: videoEvidenceDownloadBundleSchema,
})
/** 前端视频证据传输客户端边界。 */
export interface VideoEvidenceTransferClient {
    getDownload(videoId: string): Promise<VideoEvidenceDownloadBundle>
    fetchDownload(url: string): Promise<Blob>
}

/** 浏览器本地视频证据处理错误。 */
export class LocalVideoEvidenceError extends Error {
    constructor(
        readonly code: 'read_failed' | 'write_failed' | 'unsupported_version' | 'reupload_required',
    ) {
        super(`LOCAL_VIDEO_EVIDENCE_${code.toUpperCase()}`)
        this.name = 'LocalVideoEvidenceError'
    }
}

function recordId(currentEvidenceId: string) {
    return `${localEvidenceRecordPrefix}:${currentEvidenceId}`
}

function frameId(currentEvidenceId: string, position: number) {
    return `${localEvidenceRecordPrefix}:${currentEvidenceId}:frame:${position}`
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

function bytesToHex(value: ArrayBuffer) {
    return Array.from(new Uint8Array(value), (byte) =>
        byte.toString(hexadecimalRadix).padStart(hexadecimalByteWidth, '0'),
    ).join('')
}

/** 计算浏览器下载帧的 SHA-256，不把二进制转成 Base64。 */
export async function sha256VideoEvidenceBlob(content: Blob) {
    return bytesToHex(await crypto.subtle.digest('SHA-256', await content.arrayBuffer()))
}

/** 计算不含可续期 expiresAt 的不可变证据包整体摘要。 */
export async function calculateVideoEvidencePackageSha256(
    manifest: Omit<VideoEvidenceManifest, 'packageSha256'>,
) {
    const bytes = new TextEncoder().encode(
        JSON.stringify(stableValue(packageDigestInput(manifest))),
    )
    return bytesToHex(await crypto.subtle.digest('SHA-256', bytes))
}

function withoutPackageDigest(manifest: VideoEvidenceManifest) {
    const { packageSha256: omittedPackageSha256, ...withoutDigest } = manifest
    void omittedPackageSha256
    return withoutDigest
}

async function validateManifest(value: unknown) {
    const parsed = videoEvidenceManifestSchema.safeParse(value)
    if (!parsed.success) {
        const raw = value as {
            evidenceVersion?: unknown
            pipelineVersion?: unknown
            pipelineConfigVersion?: unknown
        }
        if (
            raw?.evidenceVersion !== evidenceVersion ||
            raw?.pipelineVersion !== pipelineVersion ||
            raw?.pipelineConfigVersion !== pipelineConfigVersion
        ) {
            throw new LocalVideoEvidenceError('unsupported_version')
        }
        throw new LocalVideoEvidenceError('reupload_required')
    }
    const positionsAreStable = parsed.data.frames.every(
        (frame, index) => frame.position === index && frame.timestampMs <= parsed.data.durationMs,
    )
    const digest = await calculateVideoEvidencePackageSha256(withoutPackageDigest(parsed.data))
    if (!positionsAreStable || digest !== parsed.data.packageSha256) {
        throw new LocalVideoEvidenceError('reupload_required')
    }
    return parsed.data
}

async function validateFrame(frame: Blob, expected: VideoEvidenceManifest['frames'][number]) {
    return (
        frame.type === 'image/webp' &&
        frame.size === expected.byteSize &&
        (await sha256VideoEvidenceBlob(frame)) === expected.sha256
    )
}

/** 当前账号的加密 IndexedDB 视频证据管理器。 */
export class LocalVideoEvidenceManager {
    private readonly storage: LocalVideoEvidenceStorage

    constructor(userId: string, storage?: LocalVideoEvidenceStorage) {
        const validUserId = z.string().min(1).parse(userId)
        this.storage = storage ?? new IndexedDbFileManager(validUserId)
    }

    /** 原子语义地保存清单引用和逐帧加密文件，不接受原视频。 */
    async save(manifestInput: unknown, frameContents: ReadonlyMap<number, Blob>) {
        let manifest: VideoEvidenceManifest
        try {
            manifest = await validateManifest(manifestInput)
        } catch (error) {
            if (error instanceof LocalVideoEvidenceError) {
                throw error
            }
            throw new LocalVideoEvidenceError('write_failed')
        }
        const existing = await this.storage
            .getRecord(recordId(manifest.evidenceId), localVideoEvidenceRecordSchema)
            .catch(() => null)
        const saved: LocalFileMetadata[] = []
        try {
            for (const expected of manifest.frames) {
                const content = frameContents.get(expected.position)
                if (!content || !(await validateFrame(content, expected))) {
                    throw new LocalVideoEvidenceError('reupload_required')
                }
                saved.push(
                    await this.storage.saveFile(
                        new File([content], `frame-${expected.position}.webp`, {
                            type: 'image/webp',
                        }),
                        frameId(manifest.evidenceId, expected.position),
                    ),
                )
            }
            const record = localVideoEvidenceRecordSchema.parse({
                schemaVersion: localVideoEvidenceSchemaVersion,
                evidenceId: manifest.evidenceId,
                savedAt: new Date().toISOString(),
                manifest,
                frames: saved,
            })
            await this.storage.saveRecord(recordId(manifest.evidenceId), record)
            const currentIds = new Set(saved.map((metadata) => metadata.id))
            await Promise.all(
                (existing?.frames ?? [])
                    .filter((metadata) => !currentIds.has(metadata.id))
                    .map((metadata) => this.storage.deleteFile(metadata.id)),
            )
            return record
        } catch (error) {
            if (error instanceof LocalVideoEvidenceError) {
                throw error
            }
            throw new LocalVideoEvidenceError('write_failed')
        }
    }

    /** 解密并重新校验指定证据的清单、逐帧字节和整体摘要。 */
    async get(currentEvidenceId: string) {
        try {
            const record = await this.storage.getRecord(
                recordId(z.string().uuid().parse(currentEvidenceId)),
                localVideoEvidenceRecordSchema,
            )
            if (!record) {
                return null
            }
            const manifest = await validateManifest(record.manifest)
            const frames = new Map<number, Blob>()
            for (const expected of manifest.frames) {
                const metadata = record.frames.find(
                    (candidate) => candidate.id === frameId(manifest.evidenceId, expected.position),
                )
                const local = metadata ? await this.storage.getFile(metadata.id) : null
                if (
                    !local ||
                    local.metadata.type !== 'image/webp' ||
                    !(await validateFrame(local.content, expected))
                ) {
                    throw new LocalVideoEvidenceError('reupload_required')
                }
                frames.set(expected.position, local.content)
            }
            return { manifest, frames }
        } catch (error) {
            if (error instanceof LocalVideoEvidenceError) {
                throw error.code === 'unsupported_version'
                    ? error
                    : new LocalVideoEvidenceError('reupload_required')
            }
            throw new LocalVideoEvidenceError('reupload_required')
        }
    }

    /** 删除一份本地证据及其全部帧。 */
    async delete(currentEvidenceId: string) {
        try {
            const validEvidenceId = z.string().uuid().parse(currentEvidenceId)
            const record = await this.storage.getRecord(
                recordId(validEvidenceId),
                localVideoEvidenceRecordSchema,
            )
            await Promise.all(
                (record?.frames ?? []).map((metadata) => this.storage.deleteFile(metadata.id)),
            )
            await this.storage.deleteRecord(recordId(validEvidenceId))
        } catch {
            throw new LocalVideoEvidenceError('write_failed')
        }
    }
}

/** 估算证据清单、WebP 帧、加密和 IndexedDB 元数据的占用。 */
export function estimateLocalVideoEvidenceBytes(manifest: VideoEvidenceManifest) {
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest)).byteLength
    const frameBytes = manifest.frames.reduce((total, frame) => total + frame.byteSize, 0)
    return Math.ceil(
        (manifestBytes + frameBytes + localEvidenceMetadataBytes) * encryptedStorageSafetyFactor,
    )
}

/** 读取认证下载资格，在容量决策后才下载并保存关键帧。 */
export async function preserveVideoEvidenceLocally(
    videoId: string,
    manager: LocalVideoEvidenceManager,
    transfer: VideoEvidenceTransferClient,
    options: {
        estimateCapacity: (requiredBytes: number) => Promise<StorageCapacity>
        insufficientChoice?: InsufficientStorageChoice
    },
) {
    const bundle = await transfer.getDownload(videoId)
    const manifest = await validateManifest(bundle.manifest)
    try {
        const existing = await manager.get(manifest.evidenceId)
        if (existing?.manifest.packageSha256 === manifest.packageSha256) {
            return { kind: 'preserved' as const, evidenceId: manifest.evidenceId }
        }
    } catch {
        // 云端证据仍有效时，用权威下载覆盖损坏的本地副本。
    }
    const requiredBytes = estimateLocalVideoEvidenceBytes(manifest)
    const capacity = await options.estimateCapacity(requiredBytes)
    if (capacity.status === 'insufficient') {
        if (options.insufficientChoice === 'session_only') {
            return { kind: 'session_only' as const }
        }
        return { kind: 'storage_warning' as const, capacity }
    }
    const qualificationByPosition = new Map(
        bundle.frames.map((qualification) => [qualification.position, qualification]),
    )
    const frames = new Map<number, Blob>()
    for (const expected of manifest.frames) {
        const qualification = qualificationByPosition.get(expected.position)
        if (!qualification) {
            throw new LocalVideoEvidenceError('reupload_required')
        }
        frames.set(expected.position, await transfer.fetchDownload(qualification.downloadUrl))
    }
    await manager.save(manifest, frames)
    return { kind: 'preserved' as const, evidenceId: manifest.evidenceId }
}
