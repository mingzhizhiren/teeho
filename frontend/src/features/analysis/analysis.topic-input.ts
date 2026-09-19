/** 拆分手动输入的话题，兼容标签前缀、空白和常用中英文分隔符。 */
export function parseTopicInput(value: string): string[] {
    return [...new Set(value.split(/[\s#＃,，、;；]+/u).filter(Boolean))]
}
