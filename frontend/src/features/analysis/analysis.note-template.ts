import { parseTopicInput } from './analysis.topic-input'

/** 模板分区是固定输入协议，不随界面语言翻译。 */
export const NOTE_TEMPLATE_MARKERS = ['# 标题', '# 内容', '# 话题'] as const

interface NoteTemplateLabels {
    title: string
    body: string
    multiline: string
    topics: string
}

/** 模板只包含用户提供的三项原文，不包含素材或任务选项。 */
export interface NoteTemplateFields {
    title: string
    body: string
    topics: string[]
}

export type NoteTemplateParseResult =
    | { status: 'parsed'; fields: NoteTemplateFields }
    | { status: 'invalid'; reason: 'missing' | 'duplicate' | 'order' }

/** 严格分区后一次返回候选值，不修改当前草稿。 */
export function parseNoteTemplate(value: unknown): NoteTemplateParseResult {
    if (typeof value !== 'string') return { status: 'invalid', reason: 'missing' }
    const lines = value.split(/\r\n?|\n|\u2028|\u2029/u)
    const markers = lines.flatMap((line, index) => {
        const section = NOTE_TEMPLATE_MARKERS.findIndex((marker) => marker === line.trim())
        return section < 0 ? [] : [{ section, index }]
    })
    if (
        NOTE_TEMPLATE_MARKERS.some(
            (_, section) => !markers.some((marker) => marker.section === section),
        )
    ) {
        return { status: 'invalid', reason: 'missing' }
    }
    if (markers.length !== NOTE_TEMPLATE_MARKERS.length)
        return { status: 'invalid', reason: 'duplicate' }
    if (
        markers.some((marker, index) => marker.section !== index) ||
        lines.slice(0, markers[0]!.index).some((line) => line.trim())
    ) {
        return { status: 'invalid', reason: 'order' }
    }
    const [title = '', body = '', topics = ''] = markers.map((marker, section) =>
        lines
            .slice(marker.index + 1, markers[section + 1]?.index)
            .join('\n')
            .trim(),
    )
    return {
        status: 'parsed',
        fields: { title, body, topics: parseTopicInput(topics) },
    }
}

/** 复制用模板保留中文协议标记，占位说明使用当前界面语言。 */
export function buildNoteTemplate(labels: NoteTemplateLabels): string {
    return [
        NOTE_TEMPLATE_MARKERS[0],
        labels.title,
        NOTE_TEMPLATE_MARKERS[1],
        labels.body,
        '',
        labels.multiline,
        NOTE_TEMPLATE_MARKERS[2],
        labels.topics,
    ].join('\n')
}
