import { describe, expect, test } from 'bun:test'
import type { ZodType } from 'zod'

import type { AnalysisResult, AnalysisTask } from '@/features/analysis/analysis.contract'
import { LocalHistoryManager, type LocalHistoryStorage } from '@/features/analysis/localHistory'
import {
    calculateVideoEvidencePackageSha256,
    LocalVideoEvidenceManager,
    sha256VideoEvidenceBlob,
    type VideoEvidenceManifest,
} from '@/features/analysis/localVideoEvidence'
import type { LocalFile, LocalFileMetadata } from '@/utils/indexedDbFiles'
import {
    createAnalysisResultFixture,
    createAnalysisTaskFixture,
    createResolvedTaskFieldsFixture,
    createStandardTaskFixture,
} from './analysisTestFixtures'

class MemoryStorage implements LocalHistoryStorage {
    records = new Map<string, unknown>()
    files = new Map<string, LocalFile>()

    async saveRecord<T>(id: string, value: T) {
        this.records.set(id, structuredClone(value))
    }

    async getRecord<T>(id: string, schema: ZodType<T>) {
        const value = this.records.get(id)
        return value === undefined ? null : schema.parse(structuredClone(value))
    }

    async listRecords<T>(schema: ZodType<T>, idPrefix?: string) {
        return Array.from(this.records.entries())
            .filter(([id]) => idPrefix === undefined || id.startsWith(idPrefix))
            .map(([, value]) => schema.parse(structuredClone(value)))
    }

    async deleteRecord(id: string) {
        this.records.delete(id)
    }

    async clearRecords() {
        this.records.clear()
    }

    async saveFile(file: File, id = crypto.randomUUID()) {
        const metadata: LocalFileMetadata = {
            id,
            name: file.name,
            type: file.type,
            size: file.size,
            lastModified: file.lastModified,
            createdAt: Date.now(),
        }
        this.files.set(id, { metadata, content: file.slice() })
        return metadata
    }

    async getFile(id: string) {
        return this.files.get(id) ?? null
    }

    async deleteFile(id: string) {
        this.files.delete(id)
    }

    async clearFiles() {
        this.files.clear()
    }
}

function createResult(title: string, level = 70): AnalysisResult {
    return createAnalysisResultFixture(title, level)
}

function createTask(id: string, topic: string): AnalysisTask {
    return createAnalysisTaskFixture({
        id,
        standardTask: createStandardTaskFixture({
            rawText: `${topic}的内容摘要`,
            fields: createResolvedTaskFieldsFixture({
                title: { value: topic, source: 'user_input' },
            }),
        }),
        result: createResult(`${topic}方案`),
        resultVersion: 2,
    })
}

describe('LocalHistoryManager', () => {
    test('保存最新任务、唯一结果和原始图片', async () => {
        const storage = new MemoryStorage()
        const manager = new LocalHistoryManager('user-a', storage)
        const task = createTask('task-a', '通勤防晒')
        const image = new File([new Uint8Array([1, 2, 3])], 'source.png', {
            type: 'image/png',
        })

        await manager.saveTask(task, [image])

        const [record] = await manager.listTasks()
        expect(record?.schemaVersion).toBe(2)
        expect(record?.displayName).toBe('通勤防晒')
        expect(record?.task.resultVersion).toBe(2)
        expect(record?.task.result?.qualitativeConclusion.summary).toBe('通勤防晒方案')
        expect(record?.originalImages).toHaveLength(1)
        expect(
            await manager.getOriginalImage(task.id, record!.originalImages[0]!.id),
        ).not.toBeNull()
    })

    test('较旧状态不会覆盖已保存的成功结果', async () => {
        const storage = new MemoryStorage()
        const manager = new LocalHistoryManager('user-a', storage)
        const succeeded = createTask('task-race', '并发更新')
        const queued: AnalysisTask = {
            ...structuredClone(succeeded),
            status: 'queued',
            result: null,
            resultVersion: null,
            attemptCount: 0,
            startedAt: null,
            completedAt: null,
            updatedAt: '2026-07-25T00:00:00.000Z',
        }

        await Promise.all([manager.saveTask(queued), manager.saveTask(succeeded)])

        const [record] = await manager.listTasks()
        expect(record?.task.status).toBe('succeeded')
        expect(record?.task.result?.qualitativeConclusion.summary).toBe('并发更新方案')
    })

    test('重新分析的新任务复制原任务图片且删除原任务后仍可读取', async () => {
        const storage = new MemoryStorage()
        const manager = new LocalHistoryManager('user-a', storage)
        const sourceTask = createTask('task-source', '通勤防晒')
        const reanalysisTask = createTask('task-reanalysis', '通勤防晒')
        const image = new File([new Uint8Array([1, 2, 3])], 'source.png', {
            type: 'image/png',
        })
        await manager.saveTask(sourceTask, [image])

        await manager.saveTaskFrom(reanalysisTask, sourceTask.id)
        await manager.deleteTask(sourceTask.id)

        const record = await manager.getTask(reanalysisTask.id)
        expect(record?.originalImages).toHaveLength(1)
        expect(
            await manager.getOriginalImage(reanalysisTask.id, record!.originalImages[0]!.id),
        ).not.toBeNull()
    })

    test('搜索与删除只作用于当前存储分区', async () => {
        const storage = new MemoryStorage()
        const manager = new LocalHistoryManager('user-a', storage)
        await manager.saveTask(createTask('task-search', '敏感肌防晒'))

        expect(await manager.searchTasks('敏感肌')).toHaveLength(1)
        await manager.deleteTask('task-search')
        expect(await manager.listTasks()).toHaveLength(0)
    })

    test('删除最后一个引用视频证据的历史任务时同时删除本地清单和帧', async () => {
        const storage = new MemoryStorage()
        const evidenceId = '00000000-0000-4000-8000-000000000010'
        const frame = new Blob([new Uint8Array([1, 2, 3, 4])], {
            type: 'image/webp',
        })
        const withoutDigest: Omit<VideoEvidenceManifest, 'packageSha256'> = {
            schemaVersion: 'video-evidence-manifest.v1',
            evidenceId,
            evidenceVersion: 'video-evidence.v1',
            originalSha256: 'd'.repeat(64),
            durationMs: 1_000,
            width: 1_280,
            height: 720,
            container: 'mp4',
            videoCodec: 'h264',
            hasAudio: false,
            mediaMetadata: {},
            pipelineVersion: 'ffmpeg-keyframes.v4',
            pipelineConfigVersion: 'video-preprocessing.v3',
            ffmpegVersion: 'ffmpeg fixture',
            generatedAt: '2026-08-05T00:00:00.000Z',
            expiresAt: '2026-08-06T00:00:00.000Z',
            frames: [
                {
                    position: 0,
                    timestampMs: 0,
                    selectionReason: 'first_frame',
                    sha256: await sha256VideoEvidenceBlob(frame),
                    width: 1_024,
                    height: 576,
                    byteSize: frame.size,
                    mediaType: 'image/webp',
                },
            ],
        }
        const manifest: VideoEvidenceManifest = {
            ...withoutDigest,
            packageSha256: await calculateVideoEvidencePackageSha256(withoutDigest),
        }
        await new LocalVideoEvidenceManager('user-a', storage).save(manifest, new Map([[0, frame]]))
        const task = createTask('task-video', '视频选题')
        task.structureConfigVersion = 'analysis-task.v6'
        task.pointCost = 100
        task.standardTask = {
            ...task.standardTask,
            structureVersion: 'analysis-task.v6',
            contentKind: 'video',
            imageReferences: [],
            coverReference: '20000000-0000-4000-8000-000000000001',
            videoEvidence: {
                assetId: '00000000-0000-4000-8000-000000000011',
                evidenceId,
                evidenceVersion: 'video-evidence.v1',
                originalSha256: manifest.originalSha256,
            },
        }
        const history = new LocalHistoryManager('user-a', storage)
        await history.saveTask(task)

        await history.deleteTask(task.id)

        expect(storage.files.size).toBe(0)
        expect(storage.records.size).toBe(0)
    })
})
