/** 内容分析的指标注册表；键是稳定协议标识，顺序也是默认展示顺序。 */
export const CONTENT_ANALYSIS_INDICATORS = {
    consistency: { name: '内容一致性' },
    advice: { name: '问题与优化建议' },
    weaknesses: { name: '与同类优秀笔记相比的不足' },
    termRisks: { name: '高风险词汇' },
} as const

/** 笔记关键指标注册表；媒体适用条件不会改变权限，也不会把缺失值补成零。 */
export const STRUCTURE_METRIC_INDICATORS = {
    titleLength: { name: '标题长度', appliesTo: 'all' },
    bodyLength: { name: '正文长度', appliesTo: 'all' },
    paragraphLength: { name: '平均段落长度', appliesTo: 'all' },
    paragraphCount: { name: '正文段落数', appliesTo: 'all' },
    topicCount: { name: '话题数量', appliesTo: 'all' },
    topicLength: { name: '平均话题长度', appliesTo: 'all' },
    maxTopicLength: { name: '最长话题长度', appliesTo: 'all' },
    maxParagraphLength: { name: '最长段落长度', appliesTo: 'all' },
    imageCount: { name: '图片数量', appliesTo: 'image' },
    videoDurationSeconds: { name: '视频时长', appliesTo: 'video' },
} as const

/** 报告按“结果项 → 指标”组织；新增能力先注册，再配置各类用户的开放范围。 */
export const REPORT_RESULT_REGISTRY = {
    contentAnalysis: { name: '内容分析', indicators: CONTENT_ANALYSIS_INDICATORS },
    structureMetrics: { name: '笔记关键指标', indicators: STRUCTURE_METRIC_INDICATORS },
    comparisonNotes: { name: '同类笔记对照' },
} as const

export type ContentAnalysisIndicator = keyof typeof CONTENT_ANALYSIS_INDICATORS
export type StructureMetricIndicator = keyof typeof STRUCTURE_METRIC_INDICATORS
