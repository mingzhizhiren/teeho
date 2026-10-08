import { normalizeTopicNames } from './topics'
import { extractStructureFeatures, STRUCTURE_KEYS, type StructureFeatures } from './structure'

export const EXTENDED_STRUCTURE_KEYS = [
    ...STRUCTURE_KEYS,
    'maxTopicLength',
    'maxParagraphLength',
] as const
export const STRUCTURE_EXCERPT_LENGTH = 60
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' })

export interface ExtendedStructureFeatures extends StructureFeatures {
    readonly maxTopicLength: number | null
    readonly maxParagraphLength: number
}
export interface StructureLocations {
    readonly topics: readonly { readonly index: number; readonly text: string }[]
    readonly paragraphs: readonly {
        readonly index: number
        readonly number: number
        readonly text: string
    }[]
}

function count(text: string): number {
    return [...segmenter.segment(text.normalize('NFKC').trim())].length
}

/** 原文位置与规范化最大长度一并计算，节选不会影响计数。 */
export function extractLongestStructure(
    body: string,
    topics: readonly string[],
): {
    readonly maxTopicLength: number | null
    readonly maxParagraphLength: number
    readonly locations: StructureLocations
} {
    const named = topics.flatMap((text, index) => {
        const name = normalizeTopicNames([text])[0]
        return name ? [{ text, index, length: count(name) }] : []
    })
    const paragraphs = body
        .split(/\r?\n/)
        .map((text, index) => ({ text, index }))
        .filter(({ text }) => text.trim().length > 0)
        .map(({ text, index }, position) => ({
            text,
            index,
            number: position + 1,
            length: count(text),
        }))
    const maxTopicLength = named.length ? Math.max(...named.map((item) => item.length)) : null
    const maxParagraphLength = Math.max(0, ...paragraphs.map((item) => item.length))
    return {
        maxTopicLength,
        maxParagraphLength,
        locations: {
            topics: named
                .filter((item) => item.length === maxTopicLength)
                .map(({ text, index }) => ({ text, index })),
            paragraphs: paragraphs
                .filter((item) => item.length === maxParagraphLength)
                .map(({ text, index, number }) => {
                    const characters = [...segmenter.segment(text)].map((part) => part.segment)
                    return {
                        index,
                        number,
                        text:
                            characters.slice(0, STRUCTURE_EXCERPT_LENGTH).join('') +
                            (characters.length > STRUCTURE_EXCERPT_LENGTH ? '…' : ''),
                    }
                }),
        },
    }
}

/** 八项新结构数值；旧模型继续显式使用六项提取契约。 */
export function extractExtendedStructureFeatures(
    title: string,
    body: string,
    topics: readonly string[],
): ExtendedStructureFeatures {
    const longest = extractLongestStructure(body, topics)
    return {
        ...extractStructureFeatures(title, body, topics),
        maxTopicLength: longest.maxTopicLength,
        maxParagraphLength: longest.maxParagraphLength,
    }
}
