import { describe, expect, test } from 'bun:test'

import {
    analysisTaskSchema,
    type AnalysisTask,
    type AnalysisSubmissionRequestOptions,
} from '@/features/analysis/analysis.contract'
import {
    createAnalysisSubmissionFlow,
    type AnalysisSubmissionAdapter,
    type AnalysisSubmissionInput,
} from '@/features/analysis/analysis.submission'
import { createAnalysisSubmissionIntentRegistry } from '@/features/analysis/analysisSubmissionIntents'
import { analysisMediaRequirement } from '@/features/analysis/analysis.media-requirement'
import { analysisTaskStatusTranslationKey } from '@/features/analysis/analysis.task-presentation'
import { createDeferredSubmissionFingerprint } from '@/features/analysis/effectiveInputFingerprint'
import {
    AnalysisImagesNotReadyError,
    AnalysisVideoNotReadyError,
    areDraftImagesUploaded,
    createDraftPayload,
    isDraftVideoUploaded,
    type SharedTaskDraft,
    type SharedTaskVideo,
} from '@/features/analysis/taskDraft'
import {
    createAnalysisTaskFixture,
    createSharedTaskDraftFixture,
    createStandardTaskFixture,
} from './analysisTestFixtures'

const VIDEO_ID = '20000000-0000-4000-8000-000000000002'
const SUBMISSION_ID = '20000000-0000-4000-8000-000000000003'

function processingDraft(): SharedTaskDraft {
    const draft = createSharedTaskDraftFixture()
    return {
        ...draft,
        images: draft.images.map((image) => ({
            ...image,
            status: 'processing',
            contentHash: null,
        })),
    }
}

function videoDraft(status: SharedTaskVideo['status']): SharedTaskVideo {
    return {
        localId: 'video',
        file: null,
        fileName: 'video.mp4',
        byteSize: 10,
        declaredMediaType: 'video/mp4',
        videoId: VIDEO_ID,
        status,
        uploadProgress: 100,
        queuePosition: null,
        evidenceId: null,
        errorCode: null,
        remoteUpdatedAt: null,
    }
}

function inputFor(draft = processingDraft()): AnalysisSubmissionInput {
    return {
        draft,
        mode: 'custom',
        confirmationRevision: 1,
        conversationSession: null,
        timeoutMs: 1_000,
        deferMediaPreparation: true,
    }
}

function waitingTask(): AnalysisTask {
    return createAnalysisTaskFixture({
        id: SUBMISSION_ID,
        status: 'queued',
        preparationStatus: 'waiting',
        result: null,
        resultVersion: null,
        startedAt: null,
        completedAt: null,
        attemptCount: 0,
    })
}

function adapterFor(overrides: Partial<AnalysisSubmissionAdapter> = {}): AnalysisSubmissionAdapter {
    return {
        preview: async () => {
            throw new Error('unused preview')
        },
        fingerprint: async () => {
            throw new Error('processing hashes must not be read')
        },
        submit: async () => ({
            task: waitingTask(),
            acceptance: { status: 'accepted', message: null, clarificationQuestion: null },
        }),
        recover: async () => null,
        estimateCapacity: async (requiredBytes) => ({
            status: 'sufficient',
            requiredBytes,
            availableBytes: requiredBytes,
        }),
        randomUUID: () => SUBMISSION_ID,
        ...overrides,
    }
}

function registry() {
    return createAnalysisSubmissionIntentRegistry({
        load: async () => [],
        save: async () => undefined,
        clear: async () => undefined,
    })
}

describe('deferred media preparation admission', () => {
    test('图片上传确认后即可提交，进度 100% 或失败不能代替后端确认', () => {
        const draft = processingDraft()
        expect(analysisMediaRequirement(draft).messageKey).toBeNull()
        expect(
            createDraftPayload(draft, 'custom', { deferMediaPreparation: true }).imageReferences,
        ).toEqual([draft.images[0]!.assetId!])
        expect(() => createDraftPayload(draft, 'custom')).toThrow(AnalysisImagesNotReadyError)
        for (const status of ['uploading', 'failed'] as const) {
            expect(
                areDraftImagesUploaded([{ ...draft.images[0]!, status, uploadProgress: 100 }]),
            ).toBe(false)
        }
        expect(areDraftImagesUploaded([{ ...draft.images[0]!, assetId: null }])).toBe(false)
    })

    test('视频按确认后的排队或处理状态准入，不依赖证据完成', () => {
        for (const status of ['queued', 'processing', 'ready'] as const) {
            const video = videoDraft(status)
            const draft: SharedTaskDraft = {
                ...processingDraft(),
                contentKind: 'video',
                images: [],
                video,
            }
            expect(isDraftVideoUploaded(video)).toBe(true)
            expect(analysisMediaRequirement(draft).messageKey).toBeNull()
            expect(
                createDraftPayload(draft, 'custom', { deferMediaPreparation: true }).videoReference,
            ).toBe(VIDEO_ID)
            expect(() => createDraftPayload(draft, 'custom')).toThrow(AnalysisVideoNotReadyError)
        }
        for (const status of ['uploading', 'upload_paused', 'failed'] as const) {
            expect(isDraftVideoUploaded(videoDraft(status))).toBe(false)
        }
        expect(isDraftVideoUploaded({ ...videoDraft('queued'), videoId: null })).toBe(false)
    })

    test('图片处理就绪、哈希改变和字段插入顺序不会改变提交身份', async () => {
        const draft = processingDraft()
        const pending = createDraftPayload(draft, 'custom', { deferMediaPreparation: true })
        const ready = createDraftPayload(
            {
                ...draft,
                images: draft.images.map((image) => ({
                    ...image,
                    status: 'ready',
                    contentHash: 'f'.repeat(64),
                })),
            },
            'custom',
        )
        const fingerprint = await createDeferredSubmissionFingerprint(pending)
        expect(await createDeferredSubmissionFingerprint(ready)).toBe(fingerprint)
        expect(
            await createDeferredSubmissionFingerprint({
                ...pending,
                fields: Object.fromEntries(Object.entries(pending.fields).reverse()),
            }),
        ).toBe(fingerprint)
        expect(
            await createDeferredSubmissionFingerprint({ ...pending, videoReference: VIDEO_ID }),
        ).not.toBe(fingerprint)
        expect(
            await createDeferredSubmissionFingerprint({ ...pending, coverReference: VIDEO_ID }),
        ).not.toBe(fingerprint)
    })

    test('身份序列化与后端约定使用稳定字段、引用、封面和视频 ID', async () => {
        const payload = {
            inputMode: 'custom' as const,
            rawText: '  ',
            imageReferences: [VIDEO_ID],
            fields: { title: ' 标题 ', topics: [' 标签 '] },
        }
        const serialized = JSON.stringify({
            version: 'media-references-v1',
            rawText: '',
            fields: { title: '标题', topics: ['标签'] },
            imageReferences: [VIDEO_ID],
            coverReference: VIDEO_ID,
            videoReference: null,
        })
        const expected = new Bun.CryptoHasher('sha256').update(serialized).digest('hex')
        expect(await createDeferredSubmissionFingerprint(payload)).toBe(expected)
    })

    test('状态更新使预览失效后，未知提交的重试仍复用同一 ID', async () => {
        const ids: string[] = []
        let sequence = 0
        const adapter = adapterFor({
            randomUUID: () => `submission-${++sequence}`,
            submit: async (_payload, options) => {
                ids.push(options.submissionId)
                throw new Error('response lost')
            },
        })
        const flow = createAnalysisSubmissionFlow(adapter, registry())
        const input = inputFor()
        await expect(flow.submit(input, true)).rejects.toThrow('response lost')
        flow.invalidate()
        const readyDraft = {
            ...input.draft,
            images: input.draft.images.map((image) => ({
                ...image,
                status: 'ready' as const,
                contentHash: 'a'.repeat(64),
            })),
        }
        await expect(flow.submit(inputFor(readyDraft), true)).rejects.toThrow('response lost')
        expect(ids).toEqual(['submission-1', 'submission-1'])
    })

    test('页面刷新后的新提交流程复用持久意图，不再申请第二个 ID', async () => {
        const intents = registry()
        const input = inputFor()
        const fingerprint = await createDeferredSubmissionFingerprint(
            createDraftPayload(input.draft, input.mode, { deferMediaPreparation: true }),
        )
        await intents.remember({
            submissionId: SUBMISSION_ID,
            inputFingerprint: fingerprint,
            persistHistory: true,
        })
        let options: AnalysisSubmissionRequestOptions | undefined
        const flow = createAnalysisSubmissionFlow(
            adapterFor({
                randomUUID: () => {
                    throw new Error('must reuse intent')
                },
                submit: async (_payload, requestOptions) => {
                    options = requestOptions
                    return {
                        task: waitingTask(),
                        acceptance: {
                            status: 'accepted',
                            message: null,
                            clarificationQuestion: null,
                        },
                    }
                },
            }),
            intents,
        )
        expect((await flow.submit(input, true)).task?.preparationStatus).toBe('waiting')
        expect(options?.submissionId).toBe(SUBMISSION_ID)
        expect(options?.deferMediaPreparation).toBe(true)
    })

    test('账号在意图保存期间切换后，不再发起旧账号提交', async () => {
        let isCurrent = true
        let submitted = false
        const flow = createAnalysisSubmissionFlow(
            adapterFor({
                submit: async () => {
                    submitted = true
                    throw new Error('must not submit')
                },
            }),
            {
                remember: async () => {
                    isCurrent = false
                },
                forget: async () => {
                    throw new Error('must not forget')
                },
            },
        )
        await expect(
            flow.submit({ ...inputFor(), isCurrent: () => isCurrent }, true),
        ).rejects.toThrow('analysis_submission_owner_changed')
        expect(submitted).toBe(false)
    })

    test('提交后退出时保留受理恢复记录，不用新账号追查旧请求', async () => {
        let isCurrent = true
        let recovered = false
        let forgotten = false
        const flow = createAnalysisSubmissionFlow(
            adapterFor({
                submit: async () => {
                    isCurrent = false
                    throw new Error('response lost')
                },
                recover: async () => {
                    recovered = true
                    return waitingTask()
                },
            }),
            {
                remember: async () => undefined,
                forget: async () => {
                    forgotten = true
                },
            },
        )
        await expect(
            flow.submit({ ...inputFor(), isCurrent: () => isCurrent }, true),
        ).rejects.toThrow('analysis_submission_owner_changed')
        expect(recovered).toBe(false)
        expect(forgotten).toBe(false)
    })

    test('准备中视频任务能通过响应校验，旧任务缺字段仍按排队展示', () => {
        const task = analysisTaskSchema.parse({
            ...waitingTask(),
            standardTask: createStandardTaskFixture({
                contentKind: 'video',
                videoEvidence: null,
                imageReferences: [],
            }),
        })
        expect(analysisTaskStatusTranslationKey(task)).toBe('media_preparing')
        const { preparationStatus, ...legacy } = task
        void preparationStatus
        expect(analysisTaskStatusTranslationKey(analysisTaskSchema.parse(legacy))).toBe('queued')
        for (const code of ['media_preparation_failed', 'media_preparation_timeout']) {
            expect(
                analysisTaskSchema.parse({
                    ...task,
                    status: 'technical_failed',
                    failure: { code, message: '' },
                }).failure?.code,
            ).toBe(code)
        }
    })
})
