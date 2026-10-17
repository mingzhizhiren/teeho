import { expect, test } from 'bun:test'
import { riskTextSegments } from '@/features/analysis/analysis.risk-matches'

test('highlight segmentation preserves source text, overlapping matches, repeated terms and source case', () => {
    const text = '<script>阴道阴道</script>\nAbABA'
    const segments = riskTextSegments(text, ['阴道', 'aba', '阴道阴'])
    expect(segments.map((item) => item.text).join('')).toBe(text)
    expect(segments.filter((item) => item.matched).map((item) => item.text)).toEqual([
        '阴道阴道',
        'AbABA',
    ])
    expect(riskTextSegments('unchanged', [])).toEqual([
        { start: 0, text: 'unchanged', matched: false },
    ])
})

test('highlight terms are literal backend values, not regular expressions or executable markup', () => {
    const text = 'a+b [risk] <script>alert(1)</script>'
    const segments = riskTextSegments(text, ['a+b', '[risk]', '<script>'])
    expect(segments.map((item) => item.text).join('')).toBe(text)
    expect(segments.filter((item) => item.matched).map((item) => item.text)).toEqual([
        'a+b',
        '[risk]',
        '<script>',
    ])
    expect(riskTextSegments('治愈 阴道', [])).toEqual([
        { start: 0, text: '治愈 阴道', matched: false },
    ])
})
