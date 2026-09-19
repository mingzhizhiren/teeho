import { z } from 'zod'
import type { AuthUser } from '../auth/auth.service'

export const SKILL_AUTH = {
    secretBytes: 32,
    codeBytes: 5,
    pendingMs: 600_000,
    accessMs: 900_000,
    temporaryMs: 86_400_000,
    pollMs: 5_000,
    limitWindowMs: 60_000,
    requestLimit: 30,
    accessPrefix: 'teeho_skill_',
    maxDeviceName: 80,
    hashLength: 64,
    devicePageSize: 100,
    anonymousPerIpPerDay: 20,
} as const
export const deviceTokenSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const startSchema = z
    .object({
        deviceToken: deviceTokenSchema,
        deviceName: z.string().trim().min(1).max(SKILL_AUTH.maxDeviceName),
    })
    .strict()
export const tokenSchema = z.object({ deviceToken: deviceTokenSchema }).strict()
export const anonymousSchema = startSchema.extend({ machineId: deviceTokenSchema })
const deviceCursorSchema = z
    .string()
    .regex(/^\d{1,16}:[a-f0-9]{64}$/)
    .transform((value) => {
        const [createdAt, id] = value.split(':')
        return { createdAt: Number(createdAt), id }
    })
    .pipe(
        z.object({
            createdAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
            id: deviceTokenSchema,
        }),
    )
export const deviceListSchema = z.object({ cursor: deviceCursorSchema.optional() }).strict()
export type SkillDeviceCursor = z.infer<typeof deviceCursorSchema>
export interface SkillDevicePageRequest {
    readonly now: number
    readonly cursor?: SkillDeviceCursor
}
export const approvalSchema = z
    .object({
        userCode: z
            .string()
            .trim()
            .toUpperCase()
            .regex(/^[A-F0-9]{10}$/),
        remember: z.boolean(),
    })
    .strict()
export interface SkillGrant {
    readonly id: string
    readonly codeHash: string
    readonly deviceName: string
    readonly createdAt: number
    readonly pendingUntil: number
    readonly userId: string | null
    readonly expiresAt: number | null
    readonly revoked: boolean
    readonly accessHash: string | null
    readonly accessUntil: number
}
export interface SkillStore {
    insert(grant: SkillGrant): Promise<void>
    find(field: 'id' | 'codeHash' | 'accessHash', value: string): Promise<SkillGrant | null>
    update<T>(
        id: string,
        operation: (grant: SkillGrant | null) => { grant: SkillGrant | null; result: T },
    ): Promise<T>
    list(userId: string, page: SkillDevicePageRequest): Promise<readonly SkillGrant[]>
    consume(key: string, limit: number, window: number): Promise<boolean>
    reserveAnonymous(
        id: string,
        ip: string,
        machine: string,
        day: string,
        bypassLimits?: boolean,
    ): Promise<string | null>
}
export interface SkillAuthDependencies {
    readonly debug?: boolean
    readonly store: SkillStore
    readonly now: () => number
    readonly origin: string
    readonly resolveBrowser: (token: string) => Promise<AuthUser | null>
    readonly findUser: (id: string) => Promise<AuthUser | null>
    readonly createAnonymous?: (id: string) => Promise<AuthUser>
}
export class SkillAuthError extends Error {
    constructor(
        readonly status: number,
        readonly reason: string,
    ) {
        super(reason)
    }
}
