import { analysisInputConstraints, analysisUploadConstraints } from './analysis.constants'
import { analysisTrackCatalog, type AnalysisTrackDefinition } from './tracks/analysis.tracks'

export const analysisTaskStructureVersion = 'analysis-task.v6'
export const taskFieldNames = ['track', 'customTrackName', 'title', 'body', 'topics'] as const
export type TaskFieldName = (typeof taskFieldNames)[number]
export type TaskFieldValue = string | string[] | null
export interface TaskFieldOption {
    value: string
    labelKey: string
    enabled: boolean
}
export interface TaskFieldDisplayCondition {
    field: TaskFieldName
    equals: string
}
export interface TaskFieldValidation {
    maxLength?: number
    maxItems?: number
    itemMaxLength?: number
}
export interface TaskFieldDefinition {
    name: TaskFieldName
    kind: 'select' | 'text' | 'textarea' | 'tags'
    order: number
    labelKey: string
    helpKey: string
    defaultValue: TaskFieldValue
    countsAsInput: boolean
    options?: TaskFieldOption[]
    visibleWhen?: TaskFieldDisplayCondition
    validation?: TaskFieldValidation
}
export interface AnalysisTaskConfig {
    version: typeof analysisTaskStructureVersion
    fields: TaskFieldDefinition[]
    tracks: readonly AnalysisTrackDefinition[]
    trackDefaults: Record<string, Partial<Record<TaskFieldName, TaskFieldValue>>>
    uploads: typeof analysisUploadConstraints
}
const fields: TaskFieldDefinition[] = [
    {
        name: 'track',
        kind: 'select',
        order: 0,
        labelKey: 'workspace.configFields.track.label',
        helpKey: 'workspace.configFields.track.help',
        defaultValue: null,
        countsAsInput: false,
        options: analysisTrackCatalog.map((track) => ({
            value: track.id,
            labelKey: track.labelKey,
            enabled: true,
        })),
    },
    {
        name: 'customTrackName',
        kind: 'text',
        order: 1,
        labelKey: 'workspace.configFields.customTrackName.label',
        helpKey: 'workspace.configFields.customTrackName.help',
        defaultValue: null,
        countsAsInput: false,
        visibleWhen: { field: 'track', equals: 'custom' },
        validation: { maxLength: analysisInputConstraints.fields.customTrackNameMaxLength },
    },
    {
        name: 'title',
        kind: 'text',
        order: 2,
        labelKey: 'workspace.configFields.title.label',
        helpKey: 'workspace.configFields.title.help',
        defaultValue: null,
        countsAsInput: true,
        validation: { maxLength: analysisInputConstraints.fields.titleMaxLength },
    },
    {
        name: 'body',
        kind: 'textarea',
        order: 3,
        labelKey: 'workspace.configFields.body.label',
        helpKey: 'workspace.configFields.body.help',
        defaultValue: null,
        countsAsInput: true,
        validation: { maxLength: analysisInputConstraints.fields.bodyMaxLength },
    },
    {
        name: 'topics',
        kind: 'tags',
        order: 4,
        labelKey: 'workspace.configFields.topics.label',
        helpKey: 'workspace.configFields.topics.help',
        defaultValue: [],
        countsAsInput: true,
        validation: {
            maxItems: analysisInputConstraints.fields.topicsMaxItems,
            itemMaxLength: analysisInputConstraints.fields.topicItemMaxLength,
        },
    },
]
/** 两种录入方式共用的完整笔记配置。 */
export const analysisTaskConfig: AnalysisTaskConfig = {
    version: analysisTaskStructureVersion,
    fields,
    tracks: analysisTrackCatalog,
    trackDefaults: {},
    uploads: analysisUploadConstraints,
}
/** 每份草稿持有独立默认值，不生成缺失内容。 */
export function createSystemTaskDefaults(): Record<TaskFieldName, TaskFieldValue> {
    return { track: null, customTrackName: null, title: null, body: null, topics: [] }
}
