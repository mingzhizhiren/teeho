import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import type { PGlite } from '@electric-sql/pglite'
import type { DatabaseExecutor, DatabaseTransaction } from '../db/database'
import { createCommunityDatabase } from '../../../supabase/tests/community-database'
import {
    communityTaskFixture,
    communityReportFixture,
    communityTraceFixture,
    communityUserId,
    otherCommunityUserId,
} from './community-task.fixture'

const connection = vi.hoisted(() => ({ executor: null as unknown as DatabaseExecutor }))
// 仅替换连接，不替换 repository、SQL、状态转换或 schema；永不访问远端数据库。
vi.mock('../db/database', () => ({
    db: {
        execute: (...args: unknown[]) =>
            (connection.executor.execute as (...input: unknown[]) => unknown)(...args),
    },
}))

import {
    insertResearchingAnalysisTask,
    findAnalysisTaskSubmission,
    findFailedAnalysisTask,
    findAnalysisTaskById,
} from '../analysis/tasks/analysis.task.repository'
import {
    findNextAnalysisTaskCandidate,
    claimAnalysisTaskCandidate,
    markAnalysisTaskSucceeded,
    markAnalysisTaskFailed,
    scheduleAnalysisTaskRetry,
    requeueFailedAnalysisTask,
} from '../analysis/tasks/analysis.queue.repository'
import { insertAnalysisResult } from '../analysis/tasks/analysis.result.repository'
import { analysisFingerprintConstraints } from '../analysis/analysis.fingerprints.constants'

let database: PGlite
const dialect = new PgDialect()

/** 在真实内存 PostgreSQL 执行 Drizzle SQL，仅适配 postgres-js 的行数组返回格式。 */
function executorFor(client: Pick<PGlite, 'query'>): DatabaseExecutor {
    const executor = {
        async execute<T extends Record<string, unknown>>(statement: SQL): Promise<T[]> {
            const query = dialect.sqlToQuery(statement)
            const result = await client.query<T>(query.sql, query.params)
            return result.rows
        },
    }
    // 这些 repository 仅使用 execute；实际 SQL 全部由 PGlite 执行。
    return executor as unknown as DatabaseExecutor
}

async function transaction<T>(run: (executor: DatabaseTransaction) => Promise<T>): Promise<T> {
    return database.transaction(async (client) => run(executorFor(client) as DatabaseTransaction))
}

async function createTask(id: string): Promise<string> {
    return transaction((executor) =>
        insertResearchingAnalysisTask(executor, {
            taskId: id,
            userId: communityUserId,
            inputMode: 'custom',
            inputFingerprint: '1'.repeat(64),
            fingerprints: {
                schemaVersion: analysisFingerprintConstraints.fingerprintVersion,
                quantification: '2'.repeat(64),
                level: '3'.repeat(64),
                generation: id.replaceAll('-', '').repeat(2),
            },
            standardTask: communityTaskFixture(),
            webResearchEnabled: false,
        }),
    )
}

async function claim(workerId = 'community-test') {
    return transaction(async (executor) => {
        const candidate = await findNextAnalysisTaskCandidate(executor, 300)
        expect(candidate).not.toBeNull()
        expect(candidate!.pointCost).toBe(0)
        return claimAnalysisTaskCandidate(executor, candidate!, workerId, 300, 60)
    })
}

beforeEach(async () => {
    database = await createCommunityDatabase()
    connection.executor = executorFor(database)
    await database.query('INSERT INTO auth.users (id) VALUES ($1), ($2)', [
        communityUserId,
        otherCommunityUserId,
    ])
}, 30_000)

afterEach(async () => {
    await database?.close()
})

describe('repository lifecycle against its schema', () => {
    test('创建→领取→保存结果→成功，不需要积分表且跨账号无法读取', async () => {
        const id = '00000000-0000-4000-8000-000000000111'
        expect(await createTask(id)).toBe(id)
        expect(
            await findAnalysisTaskSubmission(connection.executor, id, otherCommunityUserId),
        ).toBeNull()
        const task = await claim()
        expect(task.id).toBe(id)
        expect(task.attemptCount).toBe(1)
        await transaction(async (executor) => {
            await insertAnalysisResult(executor, {
                taskId: id,
                userId: communityUserId,
                resultVersion: task.resultVersion,
                result: communityReportFixture(),
                trace: communityTraceFixture(),
            })
            await markAnalysisTaskSucceeded(
                executor,
                id,
                communityUserId,
                task.attemptCount,
                task.workerId,
            )
        })
        const stored = await findAnalysisTaskById(communityUserId, id)
        expect(stored?.status).toBe('succeeded')
        expect(stored?.result?.primaryScore?.source).toBe('radar_average')
        expect(await findAnalysisTaskById(otherCommunityUserId, id)).toBeNull()
        await expect(
            transaction((executor) =>
                markAnalysisTaskSucceeded(
                    executor,
                    id,
                    communityUserId,
                    task.attemptCount,
                    task.workerId,
                ),
            ),
        ).rejects.toThrow()
    })

    test('自动重试和人工重试使用核心结果版本，不读取商业预留字段', async () => {
        const id = '00000000-0000-4000-8000-000000000112'
        await createTask(id)
        const first = await claim('first-worker')
        await scheduleAnalysisTaskRetry(id, communityUserId, first.attemptCount, first.workerId)
        // 只推进测试中的可领取时点，不等待真实时间或改写租约语义。
        await database.query('UPDATE public.analysis_tasks SET available_at=now() WHERE id=$1', [
            id,
        ])
        const second = await claim('second-worker')
        expect(second.attemptCount).toBe(2)
        await transaction((executor) =>
            markAnalysisTaskFailed(
                executor,
                id,
                communityUserId,
                second.attemptCount,
                second.workerId,
                { code: 'agent_timeout', message: '测试超时' },
            ),
        )
        const failed = await findFailedAnalysisTask(connection.executor, id, communityUserId)
        expect(failed?.resultVersion).toBe(1)
        expect(
            await findFailedAnalysisTask(connection.executor, id, otherCommunityUserId),
        ).toBeNull()
        expect(
            await transaction((executor) =>
                requeueFailedAnalysisTask(executor, id, otherCommunityUserId),
            ),
        ).toBe(false)
        expect(
            await transaction((executor) =>
                requeueFailedAnalysisTask(executor, id, communityUserId),
            ),
        ).toBe(true)
        const retry = await claim('manual-worker')
        expect(retry.attemptCount).toBe(1)
        expect(retry.resultVersion).toBe(1)
    })
})
