import { sql } from 'drizzle-orm'

import type { DatabaseExecutor } from '../db/database'

const accountOperationLockNamespace = 'account-operation:'

/** 串行化同一账号会改变购买、退款或新任务准入结果的业务操作。 */
export async function lockAccountOperations(executor: DatabaseExecutor, userId: string) {
    await executor.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${accountOperationLockNamespace + userId}::text, 0))`,
    )
}
