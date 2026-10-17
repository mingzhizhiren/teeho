import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createI18n } from 'vue-i18n'
import AnalysisContentAnalysis from '@/features/analysis/AnalysisContentAnalysis.vue'
import AnalysisComparisonReport from '@/features/analysis/AnalysisComparisonReport.vue'
import AnalysisRiskMatches from '@/features/analysis/AnalysisRiskMatches.vue'
import { analysisResultSchema } from '@/features/analysis/analysis.contract'
import { canShowContentIndicator } from '@/features/analysis/analysis.report-access'
import messages from '@/locales/zh-CN'

/** 在真实 Vue 组件中验证裁剪结果，不依赖截图或生产服务。 */
export async function renderReportSections(value: unknown): Promise<string> {
    const result = analysisResultSchema.parse(value)
    const app = createSSRApp({
        render: () =>
            h('article', [
                h(
                    AnalysisContentAnalysis,
                    { result },
                    {
                        footer: () =>
                            canShowContentIndicator(result.reportAccess, 'termRisks')
                                ? h(AnalysisRiskMatches, {
                                      matches: result.riskMatches,
                                      reviewStatus: result.riskReviewStatus,
                                  })
                                : null,
                    },
                ),
                h(AnalysisComparisonReport, { result }),
            ]),
    })
    app.use(createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': messages } }))
    return renderToString(app)
}
