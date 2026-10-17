import type { DatabaseExecutor } from '../db/database'
import {
    ANONYMOUS_SKILL_REPORT_ACCESS,
    FULL_REPORT_ACCESS,
    reportAccessPolicySchema,
    type ReportAccessPolicy,
} from '../analysis/report-access/analysis.report-access.policy'

/** 部署侧仅决定已登录用户的新报告权限；匿名限制由公共核心统一执行。 */
export interface ReportAccessProvider {
    anonymous?: ReportAccessPolicy
    resolveMember(userId: string, executor: DatabaseExecutor): Promise<ReportAccessPolicy>
}

let provider: ReportAccessProvider = {
    async resolveMember() {
        return FULL_REPORT_ACCESS
    },
}

/** 私有装配在启动时注入档位配置，公共核心不依赖商业模块。 */
export function configureReportAccess(value: ReportAccessProvider): void {
    provider = value
}

export function getReportAccessProvider(): ReportAccessProvider {
    return provider
}

/** 匿名默认范围可由部署配置覆盖；始终通过同一协议校验。 */
export function getAnonymousReportAccess(): ReportAccessPolicy {
    return reportAccessPolicySchema.parse(provider.anonymous ?? ANONYMOUS_SKILL_REPORT_ACCESS)
}
