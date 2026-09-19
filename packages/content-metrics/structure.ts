/** 报告使用的六项文本结构计数；不包含训练、模型或评分权重。 */
export interface StructureFeatures {
    readonly titleLength: number
    readonly titleEmojiRatio: number
    readonly bodyLength: number
    readonly paragraphLength: number
    readonly listItemCount: number
    readonly topicCount: number
}

export const STRUCTURE_KEYS = [
    'titleLength',
    'titleEmojiRatio',
    'bodyLength',
    'paragraphLength',
    'listItemCount',
    'topicCount',
] as const

const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' })
const emojiPattern = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u
const listPattern =
    /^\s*(?:[-*+•●▪]\s+|\d+[.)、．]\s*|[（(]\d+[）)]\s*|[一二三四五六七八九十]+[、.)．]\s*|第[一二三四五六七八九十\d]+步|(?:步骤|step)\s*\d+)/iu

function characters(value: string): string[] {
    return Array.from(segmenter.segment(value.normalize('NFKC').trim()), (item) => item.segment)
}

/** 长度按字素簇计数；空段落和空话题不计数，重复话题保留。 */
export function extractStructureFeatures(
    title: string,
    body: string,
    topics: readonly string[],
): StructureFeatures {
    const titleCharacters = characters(title)
    const paragraphs = body
        .split(/\r?\n/)
        .map((part) => part.trim())
        .filter(Boolean)
    return {
        titleLength: titleCharacters.length,
        titleEmojiRatio: titleCharacters.length
            ? titleCharacters.filter((character) => emojiPattern.test(character)).length /
              titleCharacters.length
            : 0,
        bodyLength: characters(body).length,
        paragraphLength: paragraphs.length
            ? paragraphs.reduce((sum, paragraph) => sum + characters(paragraph).length, 0) /
              paragraphs.length
            : 0,
        listItemCount: paragraphs.filter((paragraph) => listPattern.test(paragraph)).length,
        topicCount: topics.filter((topic) => topic.trim().length > 0).length,
    }
}
