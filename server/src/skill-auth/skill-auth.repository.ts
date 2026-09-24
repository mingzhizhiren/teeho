import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, withTransaction } from '../db/database'
import {
    SKILL_AUTH,
    type SkillGrant,
    type SkillStore,
    type SkillDevicePageRequest,
} from './skill-auth.contract'

const grantSchema = z.object({
    id: z.string(),
    codeHash: z.string(),
    deviceName: z.string(),
    createdAt: z.number(),
    pendingUntil: z.number(),
    userId: z.string().nullable(),
    expiresAt: z.number().nullable(),
    revoked: z.boolean(),
    accessHash: z.string().nullable(),
    accessUntil: z.number(),
})
/** PostgreSQL持久化授权；同一凭据的状态转移串行提交。 */
export class PostgresSkillStore implements SkillStore {
    async reserveAnonymous(
        id: string,
        ip: string,
        machine: string,
        day: string,
        bypassLimits = false,
    ): Promise<string | null> {
        return withTransaction(async (tx) => {
            for (const key of ['anonymous:' + id, 'ip:' + ip, 'machine:' + machine].sort()) {
                await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key},0))`)
            }
            const old = await tx.execute(
                sql`select user_id, machine from public.skill_anonymous_requests where id=${id}`,
            )
            if (old[0]) return old[0].machine === machine ? String(old[0].user_id) : null
            if (!bypassLimits) {
                const counts = await tx.execute(sql`select
                    (select count(*) from public.skill_anonymous_requests where day=${day} and ip=${ip}) as ip_count,
                    exists(select 1 from public.skill_anonymous_requests where machine=${machine}) as machine_used`)
                if (
                    Number(counts[0]?.ip_count) >= SKILL_AUTH.anonymousPerIpPerDay ||
                    counts[0]?.machine_used
                )
                    return null
            }
            const userId = crypto.randomUUID()
            await tx.execute(
                sql`insert into public.skill_anonymous_requests(id,ip,machine,day,user_id) values(${id},${ip},${machine},${day},${userId})`,
            )
            return userId
        })
    }
    async insert(grant: SkillGrant): Promise<void> {
        await db.execute(
            sql`insert into public.skill_device_grants(id,payload) values (${grant.id},${JSON.stringify(grant)}::jsonb) on conflict(id) do nothing`,
        )
    }
    async find(field: 'id' | 'codeHash' | 'accessHash', value: string): Promise<SkillGrant | null> {
        const rows = await db.execute(
            sql`select payload from public.skill_device_grants where payload->>${field} = ${value} limit 1`,
        )
        return rows[0] ? grantSchema.parse(rows[0].payload) : null
    }
    async update<T>(
        id: string,
        operation: (grant: SkillGrant | null) => { grant: SkillGrant | null; result: T },
        approval?: { readonly userId: string; readonly now: number },
    ): Promise<T> {
        return withTransaction(async (tx) => {
            if (approval)
                await tx.execute(
                    sql`select pg_advisory_xact_lock(hashtextextended(${'skill-account:' + approval.userId},0))`,
                )
            await tx.execute(
                sql`select pg_advisory_xact_lock(hashtextextended(${'skill:' + id},0))`,
            )
            const rows = await tx.execute(
                sql`select payload from public.skill_device_grants where id=${id} for update`,
            )
            const previous = rows[0] ? grantSchema.parse(rows[0].payload) : null
            const updated = operation(previous)
            if (updated.grant)
                await tx.execute(
                    sql`update public.skill_device_grants set payload=${JSON.stringify(updated.grant)}::jsonb where id=${id}`,
                )
            if (
                approval &&
                previous?.userId === null &&
                updated.grant?.userId === approval.userId
            ) {
                await tx.execute(sql`
                    WITH oldest AS (
                        SELECT id FROM public.skill_device_grants
                        WHERE payload->>'userId'=${approval.userId}
                          AND payload->>'revoked'='false' AND id<>${id}
                          AND (payload->>'expiresAt' IS NULL OR (payload->>'expiresAt')::bigint>${approval.now})
                        ORDER BY (payload->>'createdAt')::bigint DESC, id DESC
                        OFFSET ${SKILL_AUTH.maxActiveDevices - 1}
                        FOR UPDATE
                    )
                    UPDATE public.skill_device_grants AS grants
                    SET payload=grants.payload || '{"revoked":true,"accessHash":null,"accessUntil":0}'::jsonb
                    FROM oldest WHERE grants.id=oldest.id
                `)
            }
            return updated.result
        })
    }
    async list(userId: string, page: SkillDevicePageRequest): Promise<readonly SkillGrant[]> {
        const cursor = page.cursor
        const before = cursor
            ? sql`and ((payload->>'createdAt')::bigint, id) < (${cursor.createdAt}, ${cursor.id})`
            : sql``
        const rows = await db.execute(
            sql`select payload from public.skill_device_grants
                where payload->>'userId'=${userId} and payload->>'revoked'='false'
                and (payload->>'expiresAt' is null or (payload->>'expiresAt')::bigint > ${page.now})
                ${before}
                order by (payload->>'createdAt')::bigint desc, id desc
                limit ${SKILL_AUTH.devicePageSize + 1}`,
        )
        return rows.map((row) => grantSchema.parse(row.payload))
    }
    async consume(key: string, limit: number, window: number): Promise<boolean> {
        const rows =
            await db.execute(sql`insert into public.skill_request_limits(key,window_id,count) values (${key},${window},1)
            on conflict(key) do update set window_id=excluded.window_id,
            count=case when skill_request_limits.window_id=excluded.window_id then skill_request_limits.count+1 else 1 end
            returning count`)
        return Number(rows[0]?.count) <= limit
    }
}
