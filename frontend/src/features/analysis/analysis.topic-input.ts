/** 拆分明确的话题分隔符，保留名称内部的普通空格。 */
export function parseTopicInput(value: string): string[] {
    return [
        ...new Set(
            value
                .split(/[#＃,，、;；\r\n\t\u2028\u2029]+/u)
                .map((topic) => topic.trim())
                .filter(Boolean),
        ),
    ]
}

/** 表单恢复、模板导入和提交共用的话题列表归一化。 */
export function normalizeTopicList(topics: readonly string[]): string[] {
    return [...new Set(topics.flatMap(parseTopicInput))]
}

/** 表单始终以半角井号和单个项目间空格展示已确认的话题。 */
export function formatTopicInput(topics: readonly string[]): string {
    return normalizeTopicList(topics)
        .map((topic) => `#${topic}`)
        .join(' ')
}
