/** 内容分析固定摘要；业务流程只按报告语言选择文案。 */
export const contentAnalysisMessages = {
    'zh-CN': {
        fallbackSummary: '经Agent分析，当前笔记内容标题和内容比较匹配',
    },
    'en-US': {
        fallbackSummary: 'The Agent analysis indicates that this note’s title and content are reasonably aligned.',
    },
} as const
