import { describe, expect, test } from 'bun:test'

import type {
    AnalysisTaskConfig,
    StandardAnalysisTask,
} from '@/features/analysis/analysis.contract'
import {
    AnalysisImagesNotReadyError,
    AnalysisVideoNotReadyError,
    createDraftPayload,
    createEmptyTaskDraft,
    hasEffectiveDraftContent,
    isDraftMediaPreparing,
    getDraftFieldIssue,
    resolveDraftFieldForDisplay,
    setDraftContentKind,
} from '@/features/analysis/taskDraft'
import {
    createResolvedTaskFieldsFixture,
    createStandardTaskFixture,
    createSharedTaskDraftFixture,
} from './analysisTestFixtures'

const tracks: AnalysisTaskConfig['tracks'] = [
    ...Array.from({ length: 30 }, (_, index) => ({
        id: index === 0 ? 'beauty_skincare' : `track_${index + 1}`,
        code: index + 1,
        order: index + 1,
        labelKey: index === 0 ? 'beauty' : 'track.label',
        keywords: index === 0 ? ['护肤', '敏感肌修护'] : [`赛道${index + 1}`],
        custom: false,
    })),
    {
        id: 'custom',
        code: 0,
        order: 31,
        labelKey: 'custom',
        keywords: [],
        custom: true,
    },
]

const config: AnalysisTaskConfig = {
    version: 'analysis-task.v6',
    fields: [
        {
            name: 'track',
            kind: 'select',
            order: 10,
            labelKey: 'track.label',
            helpKey: 'track.help',
            defaultValue: 'beauty_skincare',
            countsAsInput: false,
            options: [
                { value: 'beauty_skincare', labelKey: 'beauty', enabled: true },
                { value: 'custom', labelKey: 'custom', enabled: true },
            ],
        },
        {
            name: 'title',
            kind: 'textarea',
            order: 20,
            labelKey: 'title.label',
            helpKey: 'title.help',
            defaultValue: null,
            countsAsInput: true,
        },
        {
            name: 'topics',
            kind: 'tags',
            order: 30,
            labelKey: 'topics.label',
            helpKey: 'topics.help',
            defaultValue: [],
            countsAsInput: true,
        },
        {
            name: 'body',
            kind: 'text',
            order: 40,
            labelKey: 'body.label',
            helpKey: 'body.help',
            defaultValue: null,
            countsAsInput: true,
        },
    ],
    tracks,
    trackDefaults: {},
    uploads: {
        allowedMediaTypes: ['image/jpeg', 'image/png', 'image/webp'],
        maxFiles: 4,
        maxFileBytes: 10,
        maxTotalBytes: 40,
        maxPixels: 1_000,
        retentionSeconds: 60,
        maxImagesPerMinute: 50,
        videoEnabled: true,
        video: {
            allowedMediaTypes: ['video/mp4', 'video/quicktime'],
            maxFileBytes: 100,
            maxUploadsPerMinute: 5,
            pointCost: 100,
        },
    },
    runtime: {
        mode: 'cloud',
        pointsEnabled: true,
        preparationRequestTimeoutMs: 390_000,
    },
}

describe('shared task draft', () => {
    test('正文可空且仍校验长度，标题和话题保持必填', () => {
        const draft = createSharedTaskDraftFixture({
            fields: { title: '已有标题', topics: ['生活'] },
        })
        expect(getDraftFieldIssue(draft, config)).toBeNull()
        expect(
            getDraftFieldIssue({ ...draft, fields: { topics: ['生活'] } }, config)?.field.name,
        ).toBe('title')
        expect(
            getDraftFieldIssue({ ...draft, fields: { title: '已有标题' } }, config)?.field.name,
        ).toBe('topics')
        const limited = {
            ...config,
            fields: config.fields.map((field) =>
                field.name === 'body' ? { ...field, validation: { maxLength: 2 } } : field,
            ),
        }
        expect(
            getDraftFieldIssue({ ...draft, fields: { ...draft.fields, body: '正文太长' } }, limited)
                ?.reason,
        ).toBe('maxLength')
    })
    test('视频只提交第一张封面，隐藏图片和视频不阻断另一形态', () => {
        const draft = createSharedTaskDraftFixture()
        const first = draft.images[0]!
        draft.images = [
            first,
            { ...first, localId: 'hidden-image', assetId: null, status: 'uploading' },
        ]
        draft.coverLocalId = 'hidden-image'
        draft.contentKind = 'video'
        expect(isDraftMediaPreparing(draft)).toBe(false)
        expect(createDraftPayload(draft, 'agent')).toMatchObject({
            coverReference: first.assetId,
            imageReferences: [first.assetId],
        })
        draft.contentKind = 'image'
        expect(isDraftMediaPreparing(draft)).toBe(true)
        expect(() => createDraftPayload(draft, 'agent')).toThrow(AnalysisImagesNotReadyError)
    })
    test('封面图片视频均可省略，已有封面仍随草稿提交', () => {
        const draft = createEmptyTaskDraft()
        setDraftContentKind(draft, 'image')
        expect(createDraftPayload(draft, 'custom').imageReferences).toEqual([])
        setDraftContentKind(draft, 'video')
        expect(createDraftPayload(draft, 'custom').videoReference).toBeUndefined()
        draft.images = createSharedTaskDraftFixture().images
        expect(createDraftPayload(draft, 'custom').imageReferences).toEqual(
            draft.images.map((image) => image.assetId!),
        )
    })

    test('只把仍会继续推进的图片视频状态识别为准备中', () => {
        const draft = createEmptyTaskDraft()
        draft.contentKind = 'image'
        draft.images = [
            {
                localId: 'pending-image',
                file: new File(['image'], 'pending.jpg', { type: 'image/jpeg' }),
                assetId: null,
                status: 'processing',
                uploadProgress: 100,
                contentHash: null,
                errorCode: null,
                failureStage: null,
            },
        ]
        expect(isDraftMediaPreparing(draft)).toBe(true)

        draft.images = [{ ...draft.images[0]!, status: 'failed' }]
        expect(isDraftMediaPreparing(draft)).toBe(false)

        draft.contentKind = 'video'
        draft.images = []
        draft.video = {
            localId: 'pending-video',
            file: null,
            fileName: 'pending.mp4',
            byteSize: 1,
            declaredMediaType: 'video/mp4',
            videoId: null,
            status: 'queued',
            uploadProgress: 100,
            queuePosition: null,
            evidenceId: null,
            errorCode: null,
            remoteUpdatedAt: null,
        }
        expect(isDraftMediaPreparing(draft)).toBe(true)

        draft.video = { ...draft.video, status: 'upload_paused' }
        expect(isDraftMediaPreparing(draft)).toBe(false)
    })

    test('切换形态保留全部图片和视频', () => {
        const draft = createEmptyTaskDraft()
        draft.images.push({
            localId: 'local-cover',
            file: new File(['image'], 'cover.jpg', { type: 'image/jpeg' }),
            assetId: null,
            status: 'uploading',
            contentHash: null,
            errorCode: null,
            failureStage: null,
        })

        setDraftContentKind(draft, 'video')
        expect(draft.contentKind).toBe('video')
        expect(draft.images).toHaveLength(1)

        draft.video = {
            localId: 'local-video',
            file: new File(['video'], 'finished.mp4', { type: 'video/mp4' }),
            fileName: 'finished.mp4',
            byteSize: 5,
            declaredMediaType: 'video/mp4',
            videoId: null,
            status: 'uploading',
            uploadProgress: 0,
            queuePosition: null,
            evidenceId: null,
            errorCode: null,
            remoteUpdatedAt: null,
        }
        setDraftContentKind(draft, 'image')
        expect(draft.video?.localId).toBe('local-video')
        setDraftContentKind(draft, 'video')
        expect(draft.images[0]?.localId).toBe('local-cover')
        expect(draft.video?.localId).toBe('local-video')
    })

    test('切换模式保留笔记字段和图片，专家请求不重复原始聊天', () => {
        const draft = createEmptyTaskDraft()
        draft.rawText = '防晒'
        draft.images.push({
            localId: 'local-cover',
            file: new File([new Uint8Array([1, 2, 3])], 'cover.png', {
                type: 'image/png',
            }),
            assetId: '00000000-0000-4000-8000-000000000001',
            status: 'ready',
            contentHash: 'a'.repeat(64),
            errorCode: null,
            failureStage: null,
        })
        draft.fields.title = '通勤防晒'
        draft.fields.topics = ['#通勤', ' #防晒 ']
        draft.fields.body = '记录自己的通勤防护方式。'

        const agentPayload = createDraftPayload(draft, 'agent')
        const customPayload = createDraftPayload(draft, 'custom')

        expect({ ...agentPayload, inputMode: undefined, rawText: undefined }).toEqual({
            ...customPayload,
            inputMode: undefined,
            rawText: undefined,
        })
        expect(customPayload.rawText).toBe('')
        expect(draft.rawText).toBe('防晒')
        expect(customPayload.imageReferences).toEqual(['00000000-0000-4000-8000-000000000001'])
        expect(draft.images).toHaveLength(1)
        expect(customPayload.fields).toMatchObject({
            title: '通勤防晒',
            topics: ['通勤', '防晒'],
            body: '记录自己的通勤防护方式。',
        })
    })

    test('仍在处理或失败的图片不能进入预览与提交载荷', () => {
        const draft = createEmptyTaskDraft()
        draft.images.push({
            localId: 'local-pending',
            file: new File(['pending'], 'pending.jpg', { type: 'image/jpeg' }),
            assetId: '00000000-0000-4000-8000-000000000002',
            status: 'processing',
            contentHash: null,
            errorCode: null,
            failureStage: null,
        })

        expect(() => createDraftPayload(draft, 'agent')).toThrow(AnalysisImagesNotReadyError)
    })

    test('只有 ready 视频能进入载荷，独立封面不混入内容图片', () => {
        const draft = createSharedTaskDraftFixture()
        draft.contentKind = 'video'
        draft.rawText = '面向新手，强调真实场景'
        draft.video = {
            localId: 'local-video',
            file: null,
            fileName: 'renamed.mp4',
            byteSize: 1_024,
            declaredMediaType: 'video/mp4',
            videoId: '00000000-0000-4000-8000-000000000010',
            status: 'processing',
            uploadProgress: 100,
            queuePosition: null,
            evidenceId: null,
            errorCode: null,
            remoteUpdatedAt: null,
        }

        expect(() => createDraftPayload(draft, 'custom')).toThrow(AnalysisVideoNotReadyError)

        draft.video.status = 'ready'
        draft.video.evidenceId = '00000000-0000-4000-8000-000000000011'
        expect(createDraftPayload(draft, 'custom')).toMatchObject({
            rawText: '',
            imageReferences: [],
            coverReference: '20000000-0000-4000-8000-000000000001',
            videoReference: '00000000-0000-4000-8000-000000000010',
        })
        expect(JSON.stringify(createDraftPayload(draft, 'custom'))).not.toContain('renamed.mp4')
    })

    test('浏览器阻止空任务，但允许短文本或任一有效配置内容', () => {
        const draft = createEmptyTaskDraft()

        expect(hasEffectiveDraftContent(draft, config)).toBe(false)
        draft.rawText = '防晒'
        expect(hasEffectiveDraftContent(draft, config)).toBe(true)

        draft.rawText = ''
        draft.fields.track = 'custom'
        expect(hasEffectiveDraftContent(draft, config)).toBe(false)
        draft.fields.title = '收纳'
        expect(hasEffectiveDraftContent(draft, config)).toBe(true)
    })

    test('显式用户值覆盖推断字段并保留来源', () => {
        const draft = createEmptyTaskDraft()
        const standardTask: StandardAnalysisTask = createStandardTaskFixture({
            fields: createResolvedTaskFieldsFixture({
                track: { value: 'beauty_skincare', source: 'agent_inference' },
            }),
        })

        expect(resolveDraftFieldForDisplay(draft, 'track', standardTask)).toEqual({
            value: 'beauty_skincare',
            source: 'agent_inference',
        })

        draft.fields.track = 'food_and_drink'
        expect(resolveDraftFieldForDisplay(draft, 'track', standardTask)).toEqual({
            value: 'food_and_drink',
            source: 'user_input',
        })
    })
})
