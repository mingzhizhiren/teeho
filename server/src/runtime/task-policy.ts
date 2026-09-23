import { sql, type SQL } from 'drizzle-orm'
import type { DatabaseTransaction } from '../db/database'
import type { StandardAnalysisTask } from '../analysis/analysis.schema'
import type { AnalysisTaskClaimCandidate } from '../analysis/tasks/analysis.queue.contract'

/** 部署侧任务策略。回调在原事务内运行，不能提交、回滚或创建新事务。 */
export interface TaskPolicy {
    assertAvailable(transaction: DatabaseTransaction): Promise<void>
    authorize(
        transaction: DatabaseTransaction,
        userId: string,
        task: StandardAnalysisTask,
    ): Promise<{ webResearchEnabled: boolean }>
    reserve(
        transaction: DatabaseTransaction,
        userId: string,
        taskId: string,
        version: number,
        task: StandardAnalysisTask,
    ): Promise<void>
    release(
        transaction: DatabaseTransaction,
        userId: string,
        taskId: string,
        version?: number,
    ): Promise<unknown>
    settle(
        transaction: DatabaseTransaction,
        userId: string,
        taskId: string,
        version: number,
        cost: number,
    ): Promise<unknown>
    claimAllowedSql(): SQL
    readCandidate?: (
        transaction: DatabaseTransaction,
        timeoutSeconds: number,
    ) => Promise<AnalysisTaskClaimCandidate | null>
    taskReadProjection(): SQL
    insertColumns(): SQL
    insertValues(task: StandardAnalysisTask): SQL
    publicConfiguration(): { pointsEnabled: boolean; videoPointCost: number }
}

const communityTaskPolicy: TaskPolicy = {
    async assertAvailable() {},
    async authorize() {
        return { webResearchEnabled: false }
    },
    async reserve() {},
    async release() {},
    async settle() {},
    claimAllowedSql: () => sql`true`,
    taskReadProjection: () => sql`0 AS "pointCost", NULL::text AS "pointReservationStatus"`,
    insertColumns: () => sql``,
    insertValues: () => sql``,
    publicConfiguration: () => ({ pointsEnabled: false, videoPointCost: 0 }),
}

let configuredTaskPolicy: TaskPolicy = communityTaskPolicy

/** 只由进程装配入口绑定部署策略；默认配置没有商业账户依赖。 */
export function configureTaskPolicy(policy: TaskPolicy): void {
    configuredTaskPolicy = policy
}

/** 获取部署策略，确保同一任务事务使用同一个已装配实现。 */
export function getTaskPolicy(): TaskPolicy {
    return configuredTaskPolicy
}

/** 队列、素材与视频共享部署准入门禁。 */
export function maintenanceClaimAllowedSql(): SQL {
    return configuredTaskPolicy.claimAllowedSql()
}

/** 准入暂停的稳定错误类型；具体维护机制由部署侧拥有。 */
export class MaintenanceGateClosedError extends Error {
    readonly reason = 'service_maintenance'
    constructor(message = '题火正在维护，请稍后再试') {
        super(message)
        this.name = 'MaintenanceGateClosedError'
    }
}
