import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { env } from '../config/env'

const queryClient = postgres(env.DATABASE_DIRECT_URL, {
    connect_timeout: env.DATABASE_CONNECT_TIMEOUT_SECONDS,
    idle_timeout: env.DATABASE_IDLE_TIMEOUT_SECONDS,
    max: env.DATABASE_POOL_MAX,
})

/** Drizzle 数据库实例；只负责运行时查询，schema migration 仍由 Supabase CLI 管理 */
export const db = drizzle({ client: queryClient })

/** 默认 Drizzle 数据库实例类型 */
export type Database = typeof db

/** Drizzle 事务实例类型，供 repository 接收同一个事务上下文 */
export type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/** repository 可接受的数据库执行器类型 */
export type DatabaseExecutor = Database | DatabaseTransaction

/** 在单个数据库事务中执行回调 */
export function withTransaction<T>(
    callback: (transaction: DatabaseTransaction) => Promise<T>,
): Promise<T> {
    return db.transaction(callback)
}

/** 执行轻量查询，验证数据库连接是否可用 */
export async function checkDatabaseConnection(): Promise<void> {
    await db.execute(sql`select 1`)
}

/** 关闭数据库连接池，供进程优雅退出或测试清理 */
export async function closeDatabaseConnection(): Promise<void> {
    await queryClient.end({ timeout: 5 })
}
