import {
    SKILL_AUTH,
    type SkillGrant,
    type SkillStore,
    type SkillDevicePageRequest,
} from './skill-auth.contract'
/** 数据库边界替身，仅用于授权HTTP测试。 */
export class MemorySkillStore implements SkillStore {
    private records: Readonly<Record<string, SkillGrant>> = {}
    private limits: Readonly<Record<string, number>> = {}
    private anonymous: readonly {
        id: string
        ip: string
        machine: string
        day: string
        userId: string
    }[] = []
    async reserveAnonymous(
        id: string,
        ip: string,
        machine: string,
        day: string,
        bypassLimits = false,
    ): Promise<string | null> {
        const existing = this.anonymous.find((row) => row.id === id)
        if (existing) return existing.machine === machine ? existing.userId : null
        const today = this.anonymous.filter((row) => row.day === day)
        if (
            !bypassLimits &&
            (this.anonymous.some((row) => row.machine === machine) ||
                today.filter((row) => row.ip === ip).length >= SKILL_AUTH.anonymousPerIpPerDay)
        )
            return null
        const userId = crypto.randomUUID()
        this.anonymous = [...this.anonymous, { id, ip, machine, day, userId }]
        return userId
    }
    async insert(grant: SkillGrant): Promise<void> {
        this.records = { ...this.records, [grant.id]: grant }
    }
    async find(field: 'id' | 'codeHash' | 'accessHash', value: string): Promise<SkillGrant | null> {
        return Object.values(this.records).find((grant) => grant[field] === value) ?? null
    }
    async update<T>(
        id: string,
        operation: (grant: SkillGrant | null) => { grant: SkillGrant | null; result: T },
    ): Promise<T> {
        const updated = operation(this.records[id] ?? null)
        if (updated.grant) this.records = { ...this.records, [id]: updated.grant }
        return updated.result
    }
    async list(userId: string, page: SkillDevicePageRequest): Promise<readonly SkillGrant[]> {
        const cursor = page.cursor
        return Object.values(this.records)
            .filter(
                (grant) =>
                    grant.userId === userId &&
                    !grant.revoked &&
                    (grant.expiresAt === null || grant.expiresAt > page.now) &&
                    (!cursor ||
                        grant.createdAt < cursor.createdAt ||
                        (grant.createdAt === cursor.createdAt && grant.id < cursor.id)),
            )
            .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
            .slice(0, SKILL_AUTH.devicePageSize + 1)
    }
    async consume(key: string, limit: number, window: number): Promise<boolean> {
        const id = key + window
        const count = (this.limits[id] ?? 0) + 1
        this.limits = { ...this.limits, [id]: count }
        return count <= limit
    }
}
