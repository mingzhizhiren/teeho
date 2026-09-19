import { z } from 'zod'

import {
    standardAnalysisTaskSchema,
    taskFieldNameSchema,
    taskFieldValueSchema,
} from './analysis.contract'
import {
    analysisConversationDraftSchema,
    analysisConversationMessageSchema,
    analysisConversationPendingTurnSchema,
    analysisRollingUsageSchema,
    analysisConversationTokenBudgetSchema,
    type AnalysisConversationPendingTurn,
    type AnalysisConversationState,
} from './analysis.conversation'
import { analysisUiConstraints } from './analysis.constants'
import type { SharedTaskDraft, SharedTaskImage, SharedTaskVideo } from './taskDraft'

export type AnalysisConversationPersistenceErrorCode = 'quota_exceeded' | 'storage_unavailable'

/** 为界面保留可恢复的本地存储失败语义。 */
export class AnalysisConversationPersistenceError extends Error {
    constructor(readonly code: AnalysisConversationPersistenceErrorCode) {
        super(code)
        this.name = 'AnalysisConversationPersistenceError'
    }
}

function normalizeConversationStorageError(error: unknown) {
    if (error instanceof AnalysisConversationPersistenceError) return error
    const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : ''
    return new AnalysisConversationPersistenceError(
        name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
            ? 'quota_exceeded'
            : 'storage_unavailable',
    )
}

const snapshotSchemaVersion = 'analysis-forming-conversation.v4'
const conversationImageFilePrefix = 'analysis-forming-image.v1:'

const sessionSchema = z
    .object({
        sessionId: z.string().uuid(),
        generation: z.number().int().positive(),
        browserInstanceId: z.string().uuid(),
    })
    .strict()

const draftFieldsSchema = z.partialRecord(taskFieldNameSchema, taskFieldValueSchema)
const persistedImageSchema = z
    .object({
        localId: z.string().min(1),
        fileId: z.string().startsWith(conversationImageFilePrefix),
        fileName: z.string(),
        mediaType: z.string(),
        byteSize: z.number().int().nonnegative(),
        lastModified: z.number().int().nonnegative(),
        assetId: z.string().uuid().nullable(),
        status: z.enum(['uploading', 'processing', 'ready', 'failed']),
        uploadProgress: z.number().min(0).max(analysisUiConstraints.percentageComplete),
        contentHash: z.string().nullable(),
        errorCode: z.string().nullable(),
        failureStage: z.enum(['upload', 'processing']).nullable(),
    })
    .strict()
const persistedVideoSchema = z
    .object({
        localId: z.string().min(1),
        fileName: z.string(),
        byteSize: z.number().int().positive(),
        declaredMediaType: z.enum(['video/mp4', 'video/quicktime']),
        videoId: z.string().uuid().nullable(),
        status: z.enum(['uploading', 'upload_paused', 'queued', 'processing', 'ready', 'failed']),
        uploadProgress: z.number().min(0).max(analysisUiConstraints.percentageComplete),
        queuePosition: z.number().int().positive().nullable(),
        evidenceId: z.string().uuid().nullable(),
        errorCode: z.string().nullable(),
        remoteUpdatedAt: z.string().nullable(),
    })
    .strict()
const conversationStateSchema = z
    .object({
        history: z.array(analysisConversationMessageSchema),
        completeDraft: analysisConversationDraftSchema,
        standardTask: standardAnalysisTaskSchema.nullable(),
        preparationId: z.string().min(1).nullable(),
        tokenBudget: analysisConversationTokenBudgetSchema.nullable(),
        rollingUsage: analysisRollingUsageSchema.nullable(),
    })
    .strict()
const confirmationSchema = z
    .object({
        currentRevision: z.number().int().nonnegative(),
        confirmedRevision: z.number().int().nonnegative().nullable(),
        visible: z.boolean(),
    })
    .strict()
const storedConversationSchema = z
    .object({
        schemaVersion: z.literal(snapshotSchemaVersion),
        changeId: z.string().uuid(),
        createdAt: z.string().datetime(),
        expiresAt: z.string().datetime(),
        session: sessionSchema,
        pendingComposerText: z.string().max(analysisUiConstraints.rawTextMaxLength).default(''),
        pendingTurn: analysisConversationPendingTurnSchema.nullable(),
        draft: z
            .object({
                contentKind: z.enum(['image', 'video']),
                rawText: z.string(),
                fields: draftFieldsSchema,
                images: z.array(persistedImageSchema),
                coverLocalId: z.string().min(1).nullable().optional(),
                video: persistedVideoSchema.nullable(),
            })
            .strict(),
        conversationState: conversationStateSchema.nullable(),
        draftPreview: standardAnalysisTaskSchema.nullable(),
        preparationId: z.string().min(1).nullable(),
        confirmation: confirmationSchema,
        trackLocked: z.boolean(),
    })
    .strict()

export interface AnalysisFormingConversationSnapshot {
    session: z.infer<typeof sessionSchema>
    pendingComposerText: string
    pendingTurn: AnalysisConversationPendingTurn | null
    draft: SharedTaskDraft
    conversationState: AnalysisConversationState | null
    draftPreview: z.infer<typeof standardAnalysisTaskSchema> | null
    preparationId: string | null
    confirmation: z.infer<typeof confirmationSchema>
    trackLocked: boolean
}

export interface AnalysisConversationStoragePort {
    readRecord(): Promise<unknown | null>
    writeRecord(value: unknown): Promise<void>
    clearRecord(): Promise<void>
    writeFile(id: string, file: File): Promise<void>
    readFile(id: string): Promise<File | null>
    listFileIds(): Promise<string[]>
    deleteFile(id: string): Promise<void>
}

export interface AnalysisConversationChannelEvent {
    sourcePageId: string
    kind: 'changed' | 'cleared' | 'expired' | 'unavailable'
}

export interface AnalysisConversationChannelPort {
    publish(event: AnalysisConversationChannelEvent): void
    subscribe(listener: (event: AnalysisConversationChannelEvent) => void): () => void
    close(): void
}

export type AnalysisTurnLockResult<T> = { status: 'acquired'; value: T } | { status: 'busy' }

export interface AnalysisTurnLockPort {
    runIfAvailable<T>(operation: () => Promise<T>): Promise<AnalysisTurnLockResult<T>>
}

export interface AnalysisMutationLockPort {
    runExclusive<T>(operation: () => Promise<T>): Promise<T>
}

export type AnalysisConversationRestoreResult =
    | { status: 'empty' }
    | {
          status: 'expired'
          cleanup: {
              session: z.infer<typeof sessionSchema>
              videoId: string | null
          } | null
      }
    | { status: 'reset_corrupt' }
    | { status: 'unavailable' }
    | {
          status: 'restored'
          expiresAt: string
          snapshot: AnalysisFormingConversationSnapshot
      }

interface CreatePersistenceInput {
    storage: AnalysisConversationStoragePort
    channel: AnalysisConversationChannelPort | null
    turnLock: AnalysisTurnLockPort | null
    mutationLock?: AnalysisMutationLockPort | null
    pageId: string
    browserInstanceId: string
}

function imageFileId(localId: string) {
    return `${conversationImageFilePrefix}${localId}`
}

function isConversationImageFile(id: string) {
    return id.startsWith(conversationImageFilePrefix)
}

function persistedVideo(video: SharedTaskVideo | null) {
    if (!video) return null
    return {
        localId: video.localId,
        fileName: video.fileName,
        byteSize: video.byteSize,
        declaredMediaType: video.declaredMediaType,
        videoId: video.videoId,
        status: video.status,
        uploadProgress: video.uploadProgress,
        queuePosition: video.queuePosition,
        evidenceId: video.evidenceId,
        errorCode: video.errorCode,
        remoteUpdatedAt: video.remoteUpdatedAt,
    }
}

/**
 * 浏览器任务形成会话的唯一持久化边界。正文从不进入页面协调消息，频道只通知其他页面重新读取账号密文。
 */
export function createAnalysisConversationPersistence(input: CreatePersistenceInput) {
    const pageId = z.string().min(1).parse(input.pageId)
    const browserInstanceId = z.string().uuid().parse(input.browserInstanceId)
    let stopListening: (() => void) | null = null
    let storageMutationQueue: Promise<void> = Promise.resolve()
    let retention: { createdAt: string; expiresAt: string } | null = null
    let mirrorRevision = 0

    function queueStorageMutation<T>(operation: () => Promise<T>) {
        const pending = storageMutationQueue.then(operation)
        storageMutationQueue = pending.then(
            () => undefined,
            () => undefined,
        )
        return pending
    }

    async function clearStoredData() {
        const fileIds = await input.storage.listFileIds()
        await Promise.all(
            fileIds.filter(isConversationImageFile).map((id) => input.storage.deleteFile(id)),
        )
        await input.storage.clearRecord()
        retention = null
    }

    async function restoreStoredData(
        mode: 'resume' | 'mirror',
    ): Promise<AnalysisConversationRestoreResult> {
        try {
            const raw = await input.storage.readRecord()
            if (raw === null) return { status: 'empty' }
            const stored = storedConversationSchema.parse(raw)
            if (Date.parse(stored.expiresAt) <= Date.now()) {
                const cleanup = {
                    session: stored.session,
                    videoId: stored.draft.video?.videoId ?? null,
                }
                await clearStoredData()
                input.channel?.publish({ sourcePageId: pageId, kind: 'expired' })
                return { status: 'expired' as const, cleanup }
            }
            if (stored.session.browserInstanceId !== browserInstanceId) {
                throw new Error('本地会话不属于当前浏览器实例')
            }
            const restoredImages =
                mode === 'mirror'
                    ? stored.draft.images
                    : stored.draft.images.map((image) =>
                          image.status === 'uploading'
                              ? {
                                    ...image,
                                    status: 'failed' as const,
                                    errorCode: 'upload_interrupted',
                                    failureStage: 'upload' as const,
                                }
                              : image,
                      )
            const restoredVideo = stored.draft.video
                ? {
                      ...stored.draft.video,
                      status:
                          mode === 'resume' && stored.draft.video.status === 'uploading'
                              ? ('upload_paused' as const)
                              : stored.draft.video.status,
                  }
                : null
            const shouldNormalizeStoredDraft =
                restoredImages.some(
                    (image, index) => image.status !== stored.draft.images[index]?.status,
                ) || restoredVideo?.status !== stored.draft.video?.status
            const restorable = shouldNormalizeStoredDraft
                ? storedConversationSchema.parse({
                      ...stored,
                      changeId: crypto.randomUUID(),
                      draft: {
                          ...stored.draft,
                          images: restoredImages,
                          video: restoredVideo,
                      },
                  })
                : stored
            if (shouldNormalizeStoredDraft) {
                await input.storage.writeRecord(restorable)
                input.channel?.publish({ sourcePageId: pageId, kind: 'changed' })
            }
            const images: SharedTaskImage[] = await Promise.all(
                restorable.draft.images.map(async (image) => {
                    const file = await input.storage.readFile(image.fileId)
                    if (
                        !file ||
                        file.name !== image.fileName ||
                        file.type !== image.mediaType ||
                        file.size !== image.byteSize ||
                        file.lastModified !== image.lastModified
                    ) {
                        throw new Error('本地会话图片不完整')
                    }
                    return {
                        localId: image.localId,
                        file,
                        assetId: image.assetId,
                        status: image.status,
                        uploadProgress: image.uploadProgress,
                        contentHash: image.contentHash,
                        errorCode: image.errorCode,
                        failureStage: image.failureStage,
                    }
                }),
            )
            const video: SharedTaskVideo | null = restorable.draft.video
                ? {
                      ...restorable.draft.video,
                      file: null,
                  }
                : null
            retention = { createdAt: stored.createdAt, expiresAt: stored.expiresAt }
            return {
                status: 'restored',
                expiresAt: stored.expiresAt,
                snapshot: {
                    session: stored.session,
                    pendingComposerText: restorable.pendingComposerText,
                    pendingTurn: restorable.pendingTurn,
                    draft: {
                        contentKind: restorable.draft.contentKind,
                        rawText: restorable.draft.rawText,
                        fields: restorable.draft.fields,
                        images,
                        coverLocalId: restorable.draft.coverLocalId ?? null,
                        video,
                    },
                    conversationState: restorable.conversationState,
                    draftPreview: restorable.draftPreview,
                    preparationId: restorable.preparationId,
                    confirmation: restorable.confirmation,
                    trackLocked: restorable.trackLocked,
                },
            }
        } catch {
            if (mode === 'mirror') return { status: 'unavailable' }
            try {
                await clearStoredData()
                input.channel?.publish({ sourcePageId: pageId, kind: 'cleared' })
                return { status: 'reset_corrupt' }
            } catch {
                return { status: 'unavailable' }
            }
        }
    }

    function restore() {
        mirrorRevision += 1
        return queueStorageMutation(() => restoreStoredData('resume'))
    }

    async function saveStoredData(snapshot: AnalysisFormingConversationSnapshot) {
        const activeRetention =
            retention ??
            (() => {
                const createdAt = new Date().toISOString()
                return {
                    createdAt,
                    expiresAt: new Date(
                        Date.parse(createdAt) +
                            analysisUiConstraints.formingConversationRetentionMs,
                    ).toISOString(),
                }
            })()
        retention = activeRetention
        const existingFileIds = new Set(await input.storage.listFileIds())
        const currentFileIds = new Set<string>()
        const images = await Promise.all(
            snapshot.draft.images.map(async (image) => {
                const fileId = imageFileId(image.localId)
                currentFileIds.add(fileId)
                if (!existingFileIds.has(fileId)) {
                    await input.storage.writeFile(fileId, image.file)
                }
                return {
                    localId: image.localId,
                    fileId,
                    fileName: image.file.name,
                    mediaType: image.file.type,
                    byteSize: image.file.size,
                    lastModified: image.file.lastModified,
                    assetId: image.assetId,
                    status: image.status,
                    uploadProgress: image.uploadProgress,
                    contentHash: image.contentHash,
                    errorCode: image.errorCode,
                    failureStage: image.failureStage,
                }
            }),
        )
        const stored = storedConversationSchema.parse({
            schemaVersion: snapshotSchemaVersion,
            changeId: crypto.randomUUID(),
            ...activeRetention,
            session: { ...snapshot.session, browserInstanceId },
            pendingComposerText: snapshot.pendingComposerText,
            pendingTurn: snapshot.pendingTurn,
            draft: {
                contentKind: snapshot.draft.contentKind,
                rawText: snapshot.draft.rawText,
                fields: snapshot.draft.fields,
                images,
                coverLocalId: snapshot.draft.coverLocalId ?? null,
                video: persistedVideo(snapshot.draft.video),
            },
            conversationState: snapshot.conversationState,
            draftPreview: snapshot.draftPreview,
            preparationId: snapshot.preparationId,
            confirmation: snapshot.confirmation,
            trackLocked: snapshot.trackLocked,
        })
        await input.storage.writeRecord(stored)
        await Promise.all(
            [...existingFileIds]
                .filter((id) => isConversationImageFile(id) && !currentFileIds.has(id))
                .map((id) => input.storage.deleteFile(id)),
        )
        input.channel?.publish({ sourcePageId: pageId, kind: 'changed' })
        return { expiresAt: activeRetention.expiresAt }
    }

    function save(snapshot: AnalysisFormingConversationSnapshot) {
        mirrorRevision += 1
        return queueStorageMutation(() => saveStoredData(snapshot)).catch((error: unknown) => {
            throw normalizeConversationStorageError(error)
        })
    }

    function clear() {
        mirrorRevision += 1
        return queueStorageMutation(async () => {
            await clearStoredData()
            input.channel?.publish({ sourcePageId: pageId, kind: 'cleared' })
        })
    }

    /** 提交前读取匹配当前素材身份的独立缓存副本，不再访问电脑原文件。 */
    function readImages(images: readonly SharedTaskImage[]): Promise<File[]> {
        return queueStorageMutation(async () => {
            const stored = storedConversationSchema.parse(await input.storage.readRecord())
            if (Date.parse(stored.expiresAt) <= Date.now()) {
                throw new AnalysisConversationPersistenceError('storage_unavailable')
            }
            return Promise.all(
                images.map(async (image) => {
                    const cached = stored.draft.images.find(
                        (entry) => entry.localId === image.localId,
                    )
                    if (
                        !cached ||
                        cached.assetId !== image.assetId ||
                        cached.contentHash !== image.contentHash
                    ) {
                        throw new AnalysisConversationPersistenceError('storage_unavailable')
                    }
                    const file = await input.storage.readFile(cached.fileId)
                    if (
                        !file ||
                        file.size !== cached.byteSize ||
                        file.type !== cached.mediaType ||
                        file.name !== cached.fileName ||
                        file.lastModified !== cached.lastModified
                    ) {
                        throw new AnalysisConversationPersistenceError('storage_unavailable')
                    }
                    return file
                }),
            )
        }).catch((error: unknown) => {
            throw normalizeConversationStorageError(error)
        })
    }

    function subscribe(listener: (result: AnalysisConversationRestoreResult) => void) {
        stopListening?.()
        mirrorRevision += 1
        if (!input.channel) return () => undefined
        stopListening = input.channel.subscribe((event) => {
            if (event.sourcePageId === pageId) return
            const revision = ++mirrorRevision
            if (event.kind === 'unavailable') {
                listener({ status: 'unavailable' })
                return
            }
            if (event.kind === 'cleared') {
                listener({ status: 'empty' })
                return
            }
            if (event.kind === 'expired') {
                retention = null
                listener({ status: 'expired', cleanup: null })
                return
            }
            void queueStorageMutation(() => restoreStoredData('mirror')).then((result) => {
                if (revision === mirrorRevision) listener(result)
            })
        })
        return () => {
            stopListening?.()
            stopListening = null
        }
    }

    async function runAgentTurn<T>(operation: () => Promise<T>) {
        if (!input.channel || !input.turnLock) {
            return { status: 'unavailable' as const }
        }
        return input.turnLock.runIfAvailable(operation)
    }

    async function runResultMutation<T>(operation: () => Promise<T>) {
        if (!input.channel || !input.mutationLock) {
            return { status: 'unavailable' as const }
        }
        return {
            status: 'acquired' as const,
            value: await input.mutationLock.runExclusive(operation),
        }
    }

    function notifyUnavailable() {
        mirrorRevision += 1
        input.channel?.publish({ sourcePageId: pageId, kind: 'unavailable' })
    }

    function close() {
        mirrorRevision += 1
        stopListening?.()
        stopListening = null
        input.channel?.close()
    }

    return {
        browserInstanceId,
        restore,
        save,
        readImages,
        clear,
        subscribe,
        runAgentTurn,
        runResultMutation,
        notifyUnavailable,
        close,
    }
}

export type AnalysisConversationPersistence = ReturnType<
    typeof createAnalysisConversationPersistence
>
