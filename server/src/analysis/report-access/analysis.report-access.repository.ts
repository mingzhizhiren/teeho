import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { DatabaseExecutor } from '../../db/database'

/** 只读取服务端管理的身份标记，不依赖客户端声明或可编辑的用户资料。 */
export async function isAnonymousReportOwner(
    executor: DatabaseExecutor,
    userId: string,
): Promise<boolean> {
    const rows = await executor.execute(sql`
        SELECT coalesce(raw_app_meta_data -> 'teeho_skill_anonymous' = 'true'::jsonb, false)
            AS "isAnonymous"
        FROM auth.users WHERE id = ${userId}::uuid
    `)
    return z.object({ isAnonymous: z.boolean() }).parse(rows[0]).isAnonymous
}
