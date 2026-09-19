import { z, type ZodType } from 'zod'

import {
    IndexedDbFileManager,
    type LocalFile,
    type LocalFileMetadata,
} from '@/utils/indexedDbFiles'
import { analysisUiConstraints } from './analysis.constants'
import { analysisTaskSchema, type AnalysisTask } from './analysis.contract'
import { LocalVideoEvidenceManager } from './localVideoEvidence'
const localFileMetadataSchema: ZodType<LocalFileMetadata> = z.object({
    id: z.string().min(1),
    name: z.string(),
    type: z.string(),
    size: z.number().int().nonnegative(),
    lastModified: z.number().int().nonnegative(),
    createdAt: z.number().int().nonnegative(),
})
const userIdSchema = z.string().min(1)
const localHistorySchemaVersion = analysisUiConstraints.localHistorySchemaVersion
const localHistoryRecordPrefix = 'analysis-history'

/** 单个账号的本地历史记录。 */
export interface LocalHistoryRecord {
    schemaVersion: typeof localHistorySchemaVersion
    taskId: string
    displayName: string
    savedAt: string
    task: AnalysisTask
    originalImages: LocalFileMetadata[]
}

/** 判断历史记录是否已关联任务所需的全部本地图片（视频只要求封面）。 */
export function hasCompleteLocalHistoryImages(record: LocalHistoryRecord): boolean {
    const task = record.task.standardTask
    const expectedImages =
        task.contentKind === 'video' ? (task.coverReference ? 1 : 0) : task.imageReferences.length
    return record.originalImages.length >= expectedImages
}

/** 历史结果展示层可读取的原图内容。 */
export type LocalHistoryImage = LocalFile

/** 按任务与文件标识读取历史原图的业务接口。 */
export type LocalHistoryImageLoader = (
    taskId: string,
    fileId: string,
) => Promise<LocalHistoryImage | null>

const localHistoryRecordSchema: ZodType<LocalHistoryRecord> = z.object({
    schemaVersion: z.literal(localHistorySchemaVersion),
    taskId: z.string().min(1),
    displayName: z.string().min(1),
    savedAt: z.string().min(1),
    task: analysisTaskSchema,
    originalImages: z.array(localFileMetadataSchema),
})

/** 本地历史读写依赖。 */
export interface LocalHistoryStorage {
    saveRecord<T>(id: string, value: T): Promise<void>
    getRecord<T>(id: string, schema: ZodType<T>): Promise<T | null>
    listRecords<T>(schema: ZodType<T>, idPrefix?: string): Promise<T[]>
    deleteRecord(id: string): Promise<void>
    clearRecords(): Promise<void>
    saveFile(file: File, id?: string): Promise<LocalFileMetadata>
    getFile(id: string): Promise<LocalFile | null>
    deleteFile(id: string): Promise<void>
    clearFiles(): Promise<void>
}

/** 不暴露密文、原始数据或浏览器底层异常的安全错误。 */
export class LocalHistoryError extends Error {
    readonly code: 'read_failed' | 'write_failed' | 'clear_failed'

    /**
     * 创建只向界面暴露稳定错误码的本地历史异常。
     * @param code 本地历史读取、写入或清理失败的稳定错误码
     */
    constructor(code: LocalHistoryError['code']) {
        super(`LOCAL_HISTORY_${code.toUpperCase()}`)
        this.name = 'LocalHistoryError'
        this.code = code
    }
}

/** 生成任务对应的本地历史记录 ID */
function historyRecordId(taskId: string) {
    return `${localHistoryRecordPrefix}:${taskId}`
}

/** 生成任务原始图片对应的本地文件 ID */
function originalImageId(taskId: string, index: number) {
    return `${localHistoryRecordPrefix}:${taskId}:source:${index + 1}`
}

/** 截取用于本地历史标题的文本摘要 */
function summarize(value: string) {
    const normalized = value.replace(/\s+/g, ' ').trim()
    return normalized.length > analysisUiConstraints.localHistoryNameMaxLength
        ? `${normalized.slice(0, analysisUiConstraints.localHistoryNameMaxLength)}…`
        : normalized
}

/** 根据用户笔记标题或报告摘要生成稳定历史名称。 */
export function createLocalHistoryName(task: AnalysisTask) {
    const candidates = [
        task.standardTask.fields.title?.value,
        task.result?.qualitativeConclusion.summary,
    ]

    for (const candidate of candidates) {
        if (typeof candidate === 'string') {
            const summary = summarize(candidate)
            if (summary) {
                return summary
            }
        }
    }
    return task.id
}

/** 当前 Auth 用户的加密本地分析历史。 */
export class LocalHistoryManager {
    private readonly storage: LocalHistoryStorage
    private readonly videoEvidence: LocalVideoEvidenceManager
    private readonly taskWrites = new Map<string, Promise<LocalHistoryRecord>>()

    /**
     * 创建按当前用户隔离的本地历史管理器。
     * @param userId Supabase Auth 验证后的用户 ID
     * @param storage 可选的本地历史存储适配器
     */
    constructor(userId: string, storage?: LocalHistoryStorage) {
        const validUserId = userIdSchema.parse(userId)
        this.storage = storage ?? new IndexedDbFileManager(validUserId)
        this.videoEvidence = new LocalVideoEvidenceManager(validUserId, this.storage)
    }

    /** 保存任务、最新结果和可选原始图片。 */
    async saveTask(task: AnalysisTask, originalImages?: File[]) {
        try {
            const validTask = analysisTaskSchema.parse(task)
            const previousWrite = this.taskWrites.get(validTask.id)
            const currentWrite = (previousWrite?.catch(() => undefined) ?? Promise.resolve()).then(
                async () => {
                    const recordId = historyRecordId(validTask.id)
                    const existingRecord = await this.storage.getRecord(
                        recordId,
                        localHistoryRecordSchema,
                    )
                    let imageMetadata = existingRecord?.originalImages ?? []

                    if (originalImages !== undefined) {
                        imageMetadata = await Promise.all(
                            originalImages.map((image, index) =>
                                this.storage.saveFile(image, originalImageId(validTask.id, index)),
                            ),
                        )
                        const currentImageIds = new Set(
                            imageMetadata.map((metadata) => metadata.id),
                        )
                        await Promise.all(
                            (existingRecord?.originalImages ?? [])
                                .filter((metadata) => !currentImageIds.has(metadata.id))
                                .map((metadata) => this.storage.deleteFile(metadata.id)),
                        )
                    }

                    const taskToSave =
                        existingRecord &&
                        Date.parse(existingRecord.task.updatedAt) > Date.parse(validTask.updatedAt)
                            ? existingRecord.task
                            : validTask
                    const record = localHistoryRecordSchema.parse({
                        schemaVersion: localHistorySchemaVersion,
                        taskId: taskToSave.id,
                        displayName: createLocalHistoryName(taskToSave),
                        savedAt: existingRecord?.savedAt ?? new Date().toISOString(),
                        task: taskToSave,
                        originalImages: imageMetadata,
                    })
                    await this.storage.saveRecord(recordId, record)
                    return record
                },
            )
            this.taskWrites.set(validTask.id, currentWrite)
            try {
                return await currentWrite
            } finally {
                if (this.taskWrites.get(validTask.id) === currentWrite) {
                    this.taskWrites.delete(validTask.id)
                }
            }
        } catch {
            throw new LocalHistoryError('write_failed')
        }
    }

    /** 从已保存任务复制仍可读取的原图，并为目标任务创建独立文件。 */
    async saveTaskFrom(task: AnalysisTask, sourceTaskId: string): Promise<LocalHistoryRecord> {
        try {
            const sourceRecord = await this.getTask(z.string().min(1).parse(sourceTaskId))
            if (!sourceRecord) return await this.saveTask(task)

            const sourceImages = await Promise.all(
                sourceRecord.originalImages.map((metadata) => this.storage.getFile(metadata.id)),
            )
            const originalImages = sourceImages
                .filter((image): image is LocalFile => image !== null)
                .map(
                    (image) =>
                        new File([image.content], image.metadata.name, {
                            type: image.metadata.type,
                            lastModified: image.metadata.lastModified,
                        }),
                )
            return await this.saveTask(task, originalImages)
        } catch {
            throw new LocalHistoryError('write_failed')
        }
    }

    /**
     * 读取本地保存的指定分析任务，不存在时返回 null。
     * @param taskId 目标分析任务 ID
     */
    async getTask(taskId: string) {
        try {
            return await this.storage.getRecord(
                historyRecordId(z.string().min(1).parse(taskId)),
                localHistoryRecordSchema,
            )
        } catch {
            throw new LocalHistoryError('read_failed')
        }
    }

    /**
     * 按更新时间倒序读取当前用户保存的全部本地任务。
     */
    async listTasks() {
        try {
            const records = await this.storage.listRecords(
                localHistoryRecordSchema,
                `${localHistoryRecordPrefix}:`,
            )
            return records.sort(
                (left, right) => Date.parse(right.task.createdAt) - Date.parse(left.task.createdAt),
            )
        } catch {
            throw new LocalHistoryError('read_failed')
        }
    }

    /**
     * 按任务名称、输入文本和结果内容搜索当前用户的本地历史。
     * @param query 本地历史搜索关键字
     */
    async searchTasks(query: string) {
        const normalizedQuery = query.trim().toLocaleLowerCase()
        const records = await this.listTasks()
        if (!normalizedQuery) {
            return records
        }
        return records.filter((record) => {
            const searchableText = [
                record.displayName,
                record.task.standardTask.rawText,
                record.task.standardTask.fields.title?.value,
                record.task.standardTask.fields.body?.value,
                ...(record.task.standardTask.fields.topics?.value ?? []),
                record.task.result?.qualitativeConclusion.summary,
            ]
                .filter((value): value is string => typeof value === 'string')
                .join('\n')
                .toLocaleLowerCase()
            return searchableText.includes(normalizedQuery)
        })
    }

    /**
     * 读取指定本地任务关联的原始图片。
     * @param taskId 目标分析任务 ID
     * @param fileId 任务关联的本地图片文件 ID
     */
    async getOriginalImage(taskId: string, fileId: string) {
        try {
            const record = await this.getTask(taskId)
            if (!record?.originalImages.some((metadata) => metadata.id === fileId)) {
                return null
            }
            return await this.storage.getFile(fileId)
        } catch {
            throw new LocalHistoryError('read_failed')
        }
    }

    /**
     * 删除指定任务记录及其关联的全部本地原始图片。
     * @param taskId 目标分析任务 ID
     */
    async deleteTask(taskId: string) {
        try {
            const validTaskId = z.string().min(1).parse(taskId)
            const record = await this.storage.getRecord(
                historyRecordId(validTaskId),
                localHistoryRecordSchema,
            )
            const evidenceId = record?.task.standardTask.videoEvidence?.evidenceId
            const otherRecords = evidenceId
                ? await this.storage.listRecords(
                      localHistoryRecordSchema,
                      `${localHistoryRecordPrefix}:`,
                  )
                : []
            await Promise.all([
                ...(record?.originalImages ?? []).map((metadata) =>
                    this.storage.deleteFile(metadata.id),
                ),
                evidenceId &&
                !otherRecords.some(
                    (candidate) =>
                        candidate.taskId !== validTaskId &&
                        candidate.task.standardTask.videoEvidence?.evidenceId === evidenceId,
                )
                    ? this.videoEvidence.delete(evidenceId)
                    : Promise.resolve(),
            ])
            await this.storage.deleteRecord(historyRecordId(validTaskId))
        } catch {
            throw new LocalHistoryError('clear_failed')
        }
    }

    /**
     * 清空当前用户分区内的全部本地分析历史和图片。
     */
    async clearTasks() {
        try {
            await this.storage.clearRecords()
            await this.storage.clearFiles()
        } catch {
            throw new LocalHistoryError('clear_failed')
        }
    }
}
