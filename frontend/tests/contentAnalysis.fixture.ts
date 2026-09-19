import type { ContentAnalysis } from '@/features/analysis/analysis.content-analysis'

export const contentAnalysisFixture: ContentAnalysis = {
    status: 'completed',
    originalScore: 7,
    consistency: {
        stars: 2,
        summary: '标题承诺早餐制作步骤，但素材只展示餐桌布置。',
        issues: [
            {
                location: 'cover',
                evidence: '封面仅展示摆好的餐具。',
                description: '图片未呈现标题承诺的制作过程。',
            },
        ],
    },
    termRisks: [
        {
            term: '最佳',
            category: '绝对化宣传',
            location: 'body',
            evidence: '最佳早餐方案',
            description: '这里用于推广且没有限定条件，存在绝对化表达风险。',
        },
    ],
    weaknesses: [
        {
            location: 'body',
            evidence: 'A simple breakfast with specific details.',
            description: '对照笔记提供具体用量，本篇没有相应信息。',
            referenceIds: ['reference-1'],
        },
    ],
}

export const fallbackContentAnalysisFixture: ContentAnalysis = {
    status: 'fallback',
    originalScore: 7,
    consistency: { stars: 3, summary: '本次内容分析暂时不可用。', issues: [] },
    termRisks: [],
    weaknesses: [],
}
