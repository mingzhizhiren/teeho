import { createStandardAnalysisTask } from '../analysis/analysis.resolver'
import {
    analysisInternalExecutionTraceSchema,
    type AnalysisInternalExecutionTrace,
    type StandardAnalysisTask,
} from '../analysis/analysis.schema'
import {
    checkupReportSchema,
    type CheckupReport,
} from '../analysis/checkup/analysis.checkup.contract'

export const communityUserId = '00000000-0000-4000-8000-000000000101'
export const otherCommunityUserId = '00000000-0000-4000-8000-000000000102'
const SHA256_HEX_LENGTH = 64

/** 本测试的全部内容为合成样本，不读取线上笔记、插件或模型。 */
export function communityTaskFixture(): StandardAnalysisTask {
    const imageId = '00000000-0000-4000-8000-000000000103'
    return createStandardAnalysisTask(
        {
            inputMode: 'custom',
            rawText: '',
            imageReferences: [imageId],
            coverReference: imageId,
            fields: {
                track: 'beauty_skincare',
                title: '通勤防晒',
                body: '记录通勤防晒的具体场景与使用步骤。',
                topics: ['通勤防晒'],
            },
        },
        { agentInference: {}, workspaceDefault: {} },
    )
}

export function communityReportFixture(): CheckupReport {
    return checkupReportSchema.parse({
        schemaVersion: 'analysis-result.v7',
        primaryScore: { source: 'radar_average', value: 5 },
        primaryTrack: 1,
        insight: null,
        structureMetrics: {
            titleLength: 4,
            titleEmojiRatio: 0,
            bodyLength: 20,
            paragraphLength: 20,
            listItemCount: 0,
            topicCount: 1,
        },
        structureReferences: {
            titleLength: null,
            titleEmojiRatio: null,
            bodyLength: null,
            paragraphLength: null,
            listItemCount: null,
            topicCount: null,
        },
        radar: {
            topicDemand: 5,
            titleExpression: 5,
            contentDevelopment: 5,
            readingExperience: 5,
            interactionPotential: 5,
            distinctiveness: 5,
        },
        qualitativeConclusion: { summary: '这是一份合成诊断结果。' },
        differences: [],
        comparisonNotes: [
            {
                noteId: 'synthetic-reference',
                title: '合成对照笔记',
                bodyExcerpt: '用于数据库契约测试。',
                likes: 10,
                collects: 5,
                comments: null,
                url: null,
                reason: 'similar_content',
            },
        ],
        topicSupport: { status: 'no_sources', matchedTopics: [], bonus: 0 },
    })
}

export function communityTraceFixture(): AnalysisInternalExecutionTrace {
    return analysisInternalExecutionTraceSchema.parse({
        schemaVersion: 'execution-trace.v4',
        provider: 'mock',
        model: null,
        requestId: '00000000-0000-4000-8000-000000000104',
        executionId: null,
        algorithmVersion: 'example.v1',
        evidenceSourceVersion: 'synthetic.v1',
        generateResultPromptVersion: 'synthetic.v1',
        taskStructureVersion: 'analysis-task.v6',
        evidenceVersion: 'a'.repeat(SHA256_HEX_LENGTH),
        checkupFeatureHash: 'b'.repeat(SHA256_HEX_LENGTH),
        topicEvidence: { status: 'no_sources', asOf: '2026-09-19T00:00:00.000Z', topics: [] },
        matchedNoteCount: 1,
        usage: null,
    })
}
