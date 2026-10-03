import { expect, test } from 'bun:test'
import { extractStructureFeatures, normalizeTopicNames } from './index'

test('话题名称统一全半角和外围标记，保留原有顺序与重复项', () => {
    const topics = [' ＃ＡＢＣ＃ ', ' # 早餐 # ', 'ＡＢＣ', '###', ' \n ']
    expect(normalizeTopicNames(topics)).toEqual(['ABC', '早餐', 'ABC'])
    expect(extractStructureFeatures('', '', topics)).toMatchObject({
        topicCount: 4,
        topicLength: 8 / 3,
    })
    expect(topics).toEqual([' ＃ＡＢＣ＃ ', ' # 早餐 # ', 'ＡＢＣ', '###', ' \n '])
})

test('只有标记或空白的名称没有平均话题长度，话题数量沿用原有非空项口径', () => {
    const topics = ['＃＃', '#', ' ']
    expect(normalizeTopicNames(topics)).toEqual([])
    expect(extractStructureFeatures('', '', topics)).toMatchObject({
        topicCount: 2,
        topicLength: null,
    })
})
