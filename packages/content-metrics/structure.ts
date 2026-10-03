import { normalizeTopicNames } from './topics'

/** 报告使用的六项文本结构计数；不包含训练、模型或评分权重。 */
export interface StructureFeatures {
    readonly titleLength: number
    readonly bodyLength: number
    readonly paragraphLength: number
    readonly paragraphCount: number
    readonly topicCount: number
    readonly topicLength: number | null
}

export const STRUCTURE_KEYS = [
    'titleLength',
    'bodyLength',
    'paragraphLength',
    'paragraphCount',
    'topicCount',
    'topicLength',
] as const

const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' })

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
    const topicNames = normalizeTopicNames(topics)
    return {
        titleLength: titleCharacters.length,
        bodyLength: characters(body).length,
        paragraphLength: paragraphs.length
            ? paragraphs.reduce((sum, paragraph) => sum + characters(paragraph).length, 0) /
              paragraphs.length
            : 0,
        paragraphCount: paragraphs.length,
        topicCount: topics.filter((topic) => topic.trim().length > 0).length,
        topicLength: topicNames.length
            ? topicNames.reduce((sum, topic) => sum + characters(topic).length, 0) /
              topicNames.length
            : null,
    }
}
