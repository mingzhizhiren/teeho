import {
    type AnalysisResult,
    type AnalysisTask,
    type ResolvedTaskFields,
    type StandardAnalysisTask,
} from '@/features/analysis/analysis.contract'
import type { SharedTaskDraft } from '@/features/analysis/taskDraft'

/** 为测试提供完整用户原稿和已就绪封面；不依赖生产默认值补齐缺项。 */
export function createSharedTaskDraftFixture(
    overrides: Partial<SharedTaskDraft> = {},
): SharedTaskDraft {
    const localId = 'cover-fixture'
    return {
        contentKind: 'image',
        rawText: '',
        fields: {
            track: 'beauty_skincare',
            title: '通勤防晒',
            body: '通勤防晒的实践记录。',
            topics: ['防晒', '通勤'],
        },
        coverLocalId: localId,
        images: [
            {
                localId,
                file: new File([new Uint8Array([1, 2, 3])], 'cover.png', { type: 'image/png' }),
                assetId: '20000000-0000-4000-8000-000000000001',
                status: 'ready',
                uploadProgress: 100,
                contentHash: 'a'.repeat(64),
                errorCode: null,
                failureStage: null,
            },
        ],
        video: null,
        ...overrides,
    }
}

/** 创建五字段完整笔记草稿，供正式体检与录入场景使用。 */
export function createResolvedTaskFieldsFixture(
    overrides: Partial<ResolvedTaskFields> = {},
): ResolvedTaskFields {
    const source = 'system_default' as const
    return {
        track: { value: 'beauty_skincare', source: 'user_input' },
        customTrackName: { value: null, source },
        title: { value: '通勤防晒', source: 'user_input' },
        body: { value: '通勤防晒的实践记录。', source: 'user_input' },
        topics: { value: ['#防晒', '#通勤'], source: 'user_input' },
        ...overrides,
    }
}

/** 创建当前版本的冻结标准任务。 */
export function createStandardTaskFixture(
    overrides: Partial<StandardAnalysisTask> = {},
): StandardAnalysisTask {
    return {
        structureVersion: 'analysis-task.v6',
        contentKind: 'image',
        videoEvidence: null,
        rawText: '',
        imageReferences: ['20000000-0000-4000-8000-000000000001'],
        coverReference: '20000000-0000-4000-8000-000000000001',
        fields: createResolvedTaskFieldsFixture(),
        ...overrides,
    }
}

/** 创建不包含生成内容的完整六维体检结果。 */
export function createAnalysisResultFixture(
    summary = '通勤防晒内容已准备完成。',
    level = 70,
): AnalysisResult {
    return {
        schemaVersion: 'analysis-result.v6',
        primaryTrack: 1,
        structureMetrics: {
            titleLength: 9,
            titleEmojiRatio: 0,
            bodyLength: 145,
            paragraphLength: 72.5,
            listItemCount: 2,
            topicCount: 3,
        },
        structureReferences: {
            titleLength: { low: 10, high: 18, sampleCount: 20, severity: 'minor' },
            titleEmojiRatio: { low: 0, high: 0.2, sampleCount: 20, severity: 'aligned' },
            bodyLength: { low: 100, high: 720, sampleCount: 20, severity: 'aligned' },
            paragraphLength: { low: 50, high: 100, sampleCount: 20, severity: 'aligned' },
            listItemCount: null,
            topicCount: { low: 2, high: 5, sampleCount: 20, severity: 'aligned' },
        },
        insight: {
            status: 'available',
            score: level / 10,
            limited: false,
            reference: null,
            comparison: null,
        },
        radar: {
            topicDemand: 7,
            titleExpression: 7,
            contentDevelopment: 7,
            readingExperience: 7,
            interactionPotential: 7,
            distinctiveness: 7,
        },
        qualitativeConclusion: { summary },
        differences: [],
        comparisonNotes: [
            {
                noteId: 'reference-1',
                title: 'Comparable note',
                bodyExcerpt: 'Specific details of the example.',
                likes: 100,
                collects: 50,
                comments: null,
                url: null,
                reason: 'similar_content',
            },
        ],
        topicSupport: { status: 'no_sources', matchedTopics: [], bonus: 0 },
    }
}

/** 创建工作台与本地历史共用的当前任务快照。 */
export function createAnalysisTaskFixture(overrides: Partial<AnalysisTask> = {}): AnalysisTask {
    const timestamp = '2026-07-30T00:00:00.000Z'
    return {
        id: 'task-fixture',
        inputMode: 'agent',
        inputFingerprint: 'a'.repeat(64),
        status: 'succeeded',
        structureConfigVersion: 'analysis-task.v6',
        standardTask: createStandardTaskFixture(),
        result: createAnalysisResultFixture(),
        resultVersion: 1,
        failure: null,
        pointCost: 15,
        attemptCount: 1,
        manualRetryCount: 0,
        queuePosition: null,
        expectedDurationSeconds: 60,
        createdAt: timestamp,
        queuedAt: timestamp,
        startedAt: timestamp,
        updatedAt: timestamp,
        completedAt: timestamp,
        ...overrides,
    }
}
