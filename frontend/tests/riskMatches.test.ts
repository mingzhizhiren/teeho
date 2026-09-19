import { expect, test } from 'bun:test'
import {
    matchNoteRiskWords,
    resolveRiskMatches,
    riskTextSegments,
    riskTrackCodes,
} from '@/features/analysis/analysis.risk-matches'

test('saved Agent image descriptions are excluded while original note hits remain', () => {
    const body = { term: '第一', category: '极限用语', description: '风险说明', evidence: '第一', location: 'body' as const }
    const saved = [body, { ...body, location: 'cover' as const }, { ...body, location: 'content' as const }]
    expect(resolveRiskMatches(saved, { title: '', body: '第一', topics: '' })).toEqual([body])
})

test('direct matches retain dictionary words without an Agent decision and deduplicate repeated mentions', () => {
    const matches = matchNoteRiskWords({ title: '阴道', body: '咖啡 阴道 阴道', topics: '阴道' })
    const selected = matches.filter((item) => item.term === '阴道')
    expect(new Set(selected.map((item) => item.location)).size).toBe(3)
    expect(selected.filter((item) => item.location === 'body')).toHaveLength(1)
    expect(resolveRiskMatches(undefined, { title: '', body: '阴道', topics: '' })).not.toHaveLength(
        0,
    )
    expect(resolveRiskMatches([], { title: '', body: '阴道', topics: '' })).toEqual([])
})

test('risk vocabulary uses union of all selected tracks and retains global words', () => {
    const fields = { title: '', body: '旅行治愈 杀人 阴道', topics: '' }
    for (const tracks of [[], [0], [4]]) {
        const words = matchNoteRiskWords(fields, tracks).map((item) => item.term)
        expect(words).not.toContain('治愈')
        expect(words).toContain('杀人')
        expect(words).toContain('阴道')
    }
    expect(matchNoteRiskWords(fields, [4, 5]).map((item) => item.term)).toContain('治愈')
    expect(matchNoteRiskWords(fields, [4, 2, 6, 5]).map((item) => item.term)).toContain('治愈')
})

test('saved matches are scoped using current category rules while unknown historical categories survive', () => {
    const fields = { title: '', body: '治愈', topics: '' }
    const saved = matchNoteRiskWords(fields, [5])
    expect(saved.length).toBeGreaterThan(0)
    expect(resolveRiskMatches(saved, fields, [4])).toEqual([])
    expect(resolveRiskMatches(saved, fields, [4, 5])).toEqual(saved)
    const historical = { ...saved[0]!, category: 'historical-unknown-category' }
    expect(resolveRiskMatches([historical], fields, [4])).toEqual([historical])
})

test('report tracks include fourth low-weight track and ignore invalid or duplicate codes', () => {
    expect(riskTrackCodes({ primaryTrack: 4, secondaryTracks: [2, 6, 5] })).toEqual([4, 2, 6, 5])
    const tracks = [
        { trackCode: 4, weight: 0.97 },
        { trackCode: 2, weight: 0.01 },
        { trackCode: 6, weight: 0.01 },
        { trackCode: 5, weight: 0.01 },
    ]
    expect(riskTrackCodes({ primaryTrack: 4, insight: { tracks } })).toEqual([4, 2, 6, 5])
    expect(
        riskTrackCodes({ primaryTrack: 0, secondaryTracks: [0, -1, 31, 1.5, 4, 4, 5, 6, 7, 8] }),
    ).toEqual([4, 5, 6, 7])
})

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
