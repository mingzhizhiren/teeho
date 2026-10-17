import { afterAll, beforeAll, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { createServer, type ViteDevServer } from 'vite'
import {
    restrictedReport,
    paidReport,
    freeReport,
    currentAnonymousReport,
} from './reportAccess.fixture'

let vite: ViteDevServer
let render: (report: unknown) => Promise<string>

beforeAll(async () => {
    vite = await createServer({
        root: resolve(import.meta.dirname, '..'),
        appType: 'custom',
        logLevel: 'silent',
        server: { middlewareMode: true },
    })
    const entry = await vite.ssrLoadModule('/tests/reportAccessRender.fixture.ts')
    render = entry.renderReportSections
})

afterAll(async () => {
    await vite?.close()
})

test('付费、免费与匿名报告分别渲染八、四、一篇参考，不附加升级文案', async () => {
    for (const [fixture, count] of [
        [paidReport, 8],
        [freeReport, 4],
        [currentAnonymousReport, 1],
    ] as const) {
        const html = await render(fixture)
        expect(html.match(/id="reference-/gu)).toHaveLength(count)
        expect(html).toContain(`Tier comparison ${count}`)
        expect(html).not.toContain(`Tier comparison ${count + 1}`)
        expect(html).not.toContain('升级')
    }
}, 20_000)

test('真实报告组件隐藏受限指标、建议及占位，只渲染一篇对照', async () => {
    const html = await render(restrictedReport)
    expect(html).toContain('内容一致性')
    expect(html).toContain('笔记关键指标')
    expect(html).toContain('高风险词汇')
    expect(html).toContain('data-metric="titleLength"')
    for (const hidden of [
        '平均段落长度',
        '平均话题长度',
        '图片数量',
        '视频时长',
        '问题与优化建议',
        '解锁',
        '升级',
    ])
        expect(html).not.toContain(hidden)
    expect(html.match(/id="reference-/g)).toHaveLength(1)
}, 20_000)

test('关闭结果项后不渲染模块标题、风险空态或升级占位', async () => {
    const access = restrictedReport.reportAccess
    const html = await render({
        ...restrictedReport,
        contentAnalysis: undefined,
        structureMetrics: {},
        structureReferences: {},
        comparisonNotes: [],
        reportAccess: {
            ...access,
            sections: {
                contentAnalysis: { ...access.sections.contentAnalysis, enabled: false },
                structureMetrics: { ...access.sections.structureMetrics, enabled: false },
                comparisonNotes: { enabled: false, limit: 0 },
            },
        },
    })
    for (const hidden of ['内容分析', '笔记关键指标', '同类笔记对照', '高风险词汇', '解锁', '升级'])
        expect(html).not.toContain(hidden)
}, 20_000)

test('风险组件区分 canonical 缺失与空数组，不采用内容分析中的风险占位', async () => {
    const missing = await render(restrictedReport)
    expect(missing).toContain('未提供风险检测结果。')
    expect(missing).not.toContain('未发现匹配的高风险词汇。')
    expect(missing).not.toContain('最佳')
    const empty = await render({ ...restrictedReport, riskMatches: [] })
    expect(empty).toContain('未发现匹配的高风险词汇。')
    expect(empty).not.toContain('未提供风险检测结果。')
    expect(empty).not.toContain('最佳')
}, 20_000)

test('风险组件原样展示后端保存的各级别和素材定位，保留检查未完成状态', async () => {
    const riskMatches = (['high', 'medium', 'low'] as const).map((riskLevel, index) => ({
        term: `canonical-${riskLevel}`,
        category: '历史后端分类',
        evidence: '原始证据',
        description: '原始说明',
        location: (['body', 'cover', 'content'] as const)[index]!,
        riskLevel,
    }))
    const html = await render({
        ...restrictedReport,
        primaryTrack: 4,
        secondaryTracks: [],
        contentAnalysis: { ...restrictedReport.contentAnalysis, termRisks: [] },
        riskMatches,
        riskReviewStatus: 'unavailable',
    })
    for (const item of riskMatches) expect(html).toContain(item.term)
    expect(html).toContain('高风险词汇检查未完成。')
    expect(html).not.toContain('未发现匹配的高风险词汇。')
}, 20_000)
