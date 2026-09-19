import { describe, expect, it } from 'bun:test'
import { parseTopicInput } from '@/features/analysis/analysis.topic-input'

describe('手动话题输入', () => {
    it.each([
        '#咖啡 #周末日常',
        '#咖啡#周末日常',
        '＃咖啡＃周末日常',
        '咖啡 周末日常',
        '咖啡，周末日常',
        '咖啡,周末日常',
        '咖啡\r\n周末日常',
        '咖啡、周末日常',
        '咖啡；周末日常',
        '咖啡\t周末日常',
    ])('识别分隔符：%s', (input) => {
        expect(parseTopicInput(input)).toEqual(['咖啡', '周末日常'])
    })

    it('忽略空项和重复项，保留首次出现的顺序', () => {
        expect(parseTopicInput('  #咖啡,,＃咖啡；#周末日常 #咖啡 ')).toEqual([
            '咖啡',
            '周末日常',
        ])
        expect(parseTopicInput(' #＃,，、;；\n\t ')).toEqual([])
        expect(parseTopicInput('')).toEqual([])
    })

    it('保留话题自身的文字、大小写和表情', () => {
        expect(parseTopicInput('#Coffee_Time #周末☕ #AI工具')).toEqual([
            'Coffee_Time',
            '周末☕',
            'AI工具',
        ])
    })
})
