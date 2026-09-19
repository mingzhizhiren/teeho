import {
    analysisTaskStructureVersion,
    createSystemTaskDefaults,
    taskFieldNames,
    type TaskFieldName,
    type TaskFieldValue,
} from './analysis.config'
import {
    resolvedTaskFieldsSchema,
    standardAnalysisTaskSchema,
    type AnalysisDraft,
    type StandardAnalysisTask,
    type ResolvedTaskFields,
    type TaskFieldSource,
    type VideoEvidenceReference,
} from './analysis.schema'

export type TaskFieldLayer = Partial<Record<TaskFieldName, TaskFieldValue | undefined>>
export interface TaskFieldResolutionLayers {
    userInput: TaskFieldLayer
    agentInference: TaskFieldLayer
    workspaceDefault: TaskFieldLayer
    trackDefault: TaskFieldLayer
    systemDefault: Record<TaskFieldName, TaskFieldValue>
}
export interface StandardTaskResolutionLayers {
    agentInference: TaskFieldLayer
    workspaceDefault: TaskFieldLayer
    videoEvidence?: VideoEvidenceReference | null
}
function normalize(value: TaskFieldValue | undefined): TaskFieldValue | undefined {
    if (typeof value === 'string') return value.trim() || undefined
    if (Array.isArray(value))
        return [...new Set(value.map((item) => item.trim().replace(/^#/, '')).filter(Boolean))]
    return value ?? undefined
}
/** 用户输入优先，字段来源用于追溯，不创建缺失笔记。 */
export function resolveTaskFields(layers: TaskFieldResolutionLayers): ResolvedTaskFields {
    const order: Array<[TaskFieldSource, TaskFieldLayer]> = [
        ['user_input', layers.userInput],
        ['agent_inference', layers.agentInference],
        ['workspace_default', layers.workspaceDefault],
        ['track_default', layers.trackDefault],
        ['system_default', layers.systemDefault],
    ]
    return resolvedTaskFieldsSchema.parse(
        Object.fromEntries(
            taskFieldNames.map((name) => {
                const selected = order.find(([, fields]) => normalize(fields[name]) !== undefined)
                return [
                    name,
                    selected
                        ? { value: normalize(selected[1][name]), source: selected[0] }
                        : { value: name === 'topics' ? [] : null, source: 'system_default' },
                ]
            }),
        ),
    )
}
/** 正式任务只冻结用户已确认的完整笔记，不重复携带原始聊天。 */
export function createStandardAnalysisTask(
    draft: AnalysisDraft,
    layers: StandardTaskResolutionLayers,
): StandardAnalysisTask {
    const fields = resolveTaskFields({
        userInput: draft.fields,
        agentInference: layers.agentInference,
        workspaceDefault: layers.workspaceDefault,
        trackDefault: {},
        systemDefault: {
            ...createSystemTaskDefaults(),
            ...(!draft.fields.track ? { track: 'custom', customTrackName: '未分类' } : {}),
        },
    })
    if (!fields.title.value || !fields.topics.value.length) throw new Error('请提供完整标题和话题')
    if (draft.videoReference && layers.videoEvidence?.assetId !== draft.videoReference)
        throw new Error('视频草稿与证据引用不一致')
    if (!draft.videoReference && !draft.coverReference) throw new Error('请提供封面')
    const coverReference = draft.coverReference
    return standardAnalysisTaskSchema.parse({
        structureVersion: analysisTaskStructureVersion,
        contentKind: draft.videoReference ? 'video' : 'image',
        coverReference,
        videoEvidence: layers.videoEvidence ?? null,
        rawText: '',
        imageReferences: [...draft.imageReferences],
        fields: { ...fields, body: { ...fields.body, value: fields.body.value ?? '' } },
        evidence: {
            rawText: '',
            imageReferences: [...draft.imageReferences],
            title: fields.title.value,
            body: fields.body.value ?? '',
            topics: [...fields.topics.value],
        },
    })
}
