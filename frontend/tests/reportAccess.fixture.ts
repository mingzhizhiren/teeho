import type { ReportAccess } from '@/features/analysis/analysis.report-access'
import { structureMetricNames } from '@/features/analysis/analysis.structure-metrics'
import { checkupResult } from './checkupResult.fixture'
import { contentAnalysisFixture } from './contentAnalysis.fixture'

/** 合成的匿名报告权限，与真实账号及当前套餐无关。 */
export const anonymousReportAccess: ReportAccess = {
    version: 'report-access.v1',
    sections: {
        contentAnalysis: {
            enabled: true,
            indicators: { consistency: true, advice: false, weaknesses: true, termRisks: true },
        },
        structureMetrics: {
            enabled: true,
            indicators: {
                titleLength: true,
                bodyLength: true,
                paragraphLength: false,
                paragraphCount: true,
                topicCount: true,
                topicLength: false,
                maxTopicLength: true,
                maxParagraphLength: true,
                imageCount: false,
                videoDurationSeconds: false,
            },
        },
        comparisonNotes: { enabled: true, limit: 1 },
    },
    footer: '🌐向agent发送：“登录题火”解锁显示更多诊断信息',
}

export const fullReportAccess: ReportAccess = {
    ...anonymousReportAccess,
    sections: {
        contentAnalysis: {
            enabled: true,
            indicators: { consistency: true, advice: true, weaknesses: true, termRisks: true },
        },
        structureMetrics: {
            enabled: true,
            indicators: Object.fromEntries(
                structureMetricNames.map((name) => [name, true]),
            ) as ReportAccess['sections']['structureMetrics']['indicators'],
        },
        comparisonNotes: { enabled: true, limit: 4 },
    },
    footer: null,
}

/** 仅保留允许的公开字段，隐藏项不使用零值或空数组伪装。 */
export const restrictedReport = {
    schemaVersion: checkupResult.schemaVersion,
    primaryTrack: checkupResult.primaryTrack,
    insight: checkupResult.insight,
    structureMetrics: { titleLength: 9, bodyLength: 145, paragraphCount: 2, topicCount: 3 },
    structureReferences: {
        titleLength: checkupResult.structureReferences.titleLength,
        bodyLength: checkupResult.structureReferences.bodyLength,
        paragraphCount: checkupResult.structureReferences.paragraphCount,
        topicCount: checkupResult.structureReferences.topicCount,
    },
    contentAnalysis: contentAnalysisFixture,
    comparisonNotes: checkupResult.comparisonNotes,
    reportAccess: anonymousReportAccess,
}

/** 新版付费档八篇参考，旧版四篇权限快照继续单独保留。 */
export const paidReportAccess: ReportAccess = {
    ...fullReportAccess,
    version: 'report-access.v2',
    sections: { ...fullReportAccess.sections, comparisonNotes: { enabled: true, limit: 8 } },
}

export const paidReport = {
    ...checkupResult,
    contentAnalysis: contentAnalysisFixture,
    reportAccess: paidReportAccess,
    comparisonNotes: Array.from({ length: 8 }, (_, index) => ({
        ...checkupResult.comparisonNotes[0]!,
        noteId: `reference-${index + 1}`,
        title: `Tier comparison ${index + 1}`,
    })),
}

export const freeReport = {
    ...restrictedReport,
    structureMetrics: checkupResult.structureMetrics,
    structureReferences: checkupResult.structureReferences,
    reportAccess: {
        ...paidReportAccess,
        sections: { ...paidReportAccess.sections, comparisonNotes: { enabled: true, limit: 4 } },
    },
    comparisonNotes: paidReport.comparisonNotes.slice(0, 4),
}

export const currentAnonymousReport = {
    ...restrictedReport,
    reportAccess: { ...anonymousReportAccess, version: 'report-access.v2' as const },
    comparisonNotes: paidReport.comparisonNotes.slice(0, 1),
}

/** v3 使用冻结的免费、Coffee、Plus 配额，不查询当前套餐。 */
export function tierReport(limit: 4 | 8 | 10): typeof paidReport | typeof freeReport {
    return {
        ...(limit === 10 ? paidReport : freeReport),
        reportAccess: {
            ...paidReportAccess,
            version: 'report-access.v3',
            sections: { ...paidReportAccess.sections, comparisonNotes: { enabled: true, limit } },
        },
        comparisonNotes: Array.from({ length: limit }, (_, index) => ({
            ...paidReport.comparisonNotes[0]!,
            noteId: `reference-${index + 1}`,
            title: `Tier comparison ${index + 1}`,
        })),
    }
}
