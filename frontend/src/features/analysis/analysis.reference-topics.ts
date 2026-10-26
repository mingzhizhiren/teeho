/** 将采集内容中的小红书话题标记转为阅读格式，不修改保存的数据。 */
export function normalizeReferenceTopics(text: string): string {
    return text.replace(/#([^#\r\n]+?)\[话题\]#/gu, (_match, name: string, offset: number, source: string) => {
        const end = offset + _match.length
        return `#${name}${source[end] === '#' ? ' ' : ''}`
    })
}

/** 独立话题列表兼容带井号和平台标记的历史数据。 */
export function formatReferenceTopics(topics: readonly string[]): string {
    return topics.map((topic) => normalizeReferenceTopics(`#${topic.replace(/^#+/u, '')}`)).join(' ')
}
