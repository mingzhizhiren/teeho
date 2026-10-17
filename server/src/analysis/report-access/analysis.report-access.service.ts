import type { DatabaseExecutor } from '../../db/database'
import { getReportAccessProvider, getAnonymousReportAccess } from '../../runtime/report-access'
import {
    insertAnalysisResult,
    type CreateAnalysisResultParam,
} from '../tasks/analysis.result.repository'
import type { AnalysisTaskRecord } from '../tasks/analysis.task.repository'
import { isAnonymousReportOwner } from './analysis.report-access.repository'
import { FULL_REPORT_ACCESS, reportAccessPolicySchema } from './analysis.report-access.policy'
import {
    projectCheckupReport,
    type ProjectedCheckupReport,
} from './analysis.report-access.projection'

/** 新结果与当时的可见范围同事务保存；以后查看不重新查询订阅档位。 */
export async function saveAnalysisResultWithAccess(
    executor: DatabaseExecutor,
    param: CreateAnalysisResultParam,
): Promise<void> {
    const anonymous = await isAnonymousReportOwner(executor, param.userId)
    const reportAccess = reportAccessPolicySchema.parse(
        anonymous
            ? getAnonymousReportAccess()
            : await getReportAccessProvider().resolveMember(param.userId, executor),
    )
    await insertAnalysisResult(executor, {
        ...param,
        trace: { ...param.trace, reportAccess },
    })
}

export type DeliveredAnalysisTask = Omit<
    AnalysisTaskRecord,
    'result' | 'savedReportAccess' | 'anonymousReportOwner'
> & {
    result: ProjectedCheckupReport | null
}

/** 所有任务响应共用此出口；旧正式账号报告全量保留，匿名历史不能绕过限制。 */
export function deliverAnalysisTask(task: AnalysisTaskRecord | null): DeliveredAnalysisTask | null {
    if (!task) return null
    const { savedReportAccess, anonymousReportOwner, result, ...publicTask } = task
    const access =
        savedReportAccess ??
        (anonymousReportOwner ? getAnonymousReportAccess() : FULL_REPORT_ACCESS)
    return { ...publicTask, result: result ? projectCheckupReport(result, access) : null }
}
