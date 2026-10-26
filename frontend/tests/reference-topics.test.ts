import { expect, test } from 'bun:test'
import { formatReferenceTopics, normalizeReferenceTopics } from '../src/features/analysis/analysis.reference-topics'

test('小红书话题去掉平台标记，紧邻话题保留分隔', () => {
    expect(normalizeReferenceTopics('#健身[话题]##力量训练[话题]#')).toBe('#健身 #力量训练')
    expect(normalizeReferenceTopics('正文 #健身[话题]#\n下一段')).toBe('正文 #健身\n下一段')
})

test('普通正文、普通话题及非话题标记保持原样', () => {
    const text = '正文提到[话题]，保留 #健身 #daily life\n下一段'
    expect(normalizeReferenceTopics(text)).toBe(text)
})

test('独立话题兼容原始名称与平台格式，不重复井号', () => {
    expect(formatReferenceTopics(['健身', '#力量训练[话题]#', 'daily life'])).toBe('#健身 #力量训练 #daily life')
})
