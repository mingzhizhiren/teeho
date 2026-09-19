import { HTTP_STATUS } from '../config/constants'
import { createHash, randomBytes } from 'node:crypto'
import {
    SKILL_AUTH,
    SkillAuthError,
    type SkillAuthDependencies,
    type SkillGrant,
    type SkillDeviceCursor,
} from './skill-auth.contract'

/** 设备凭据只持久化摘要。 */
export function skillDigest(value: string): string {
    return createHash('sha256').update(value).digest('hex')
}

/** 设备授权生命周期；不读取HTTP或启动后台轮询。 */
export function createSkillAuthService(deps: SkillAuthDependencies) {
    const { store, now } = deps
    async function throttle(key: string): Promise<void> {
        const window = Math.floor(now() / SKILL_AUTH.limitWindowMs)
        if (!(await store.consume(skillDigest(key), SKILL_AUTH.requestLimit, window)))
            throw new SkillAuthError(HTTP_STATUS.TOO_MANY_REQUESTS, 'rate_limited')
    }
    function active(grant: SkillGrant | null): asserts grant is SkillGrant & { userId: string } {
        if (!grant || grant.revoked || (grant.expiresAt !== null && grant.expiresAt <= now()))
            throw new SkillAuthError(HTTP_STATUS.UNAUTHORIZED, 'authorization_expired')
        if (!grant.userId) {
            if (grant.pendingUntil <= now())
                throw new SkillAuthError(HTTP_STATUS.UNAUTHORIZED, 'authorization_expired')
            throw new SkillAuthError(HTTP_STATUS.CONFLICT, 'authorization_pending')
        }
    }
    return {
        async devices(browserToken: string, cursor?: SkillDeviceCursor) {
            const user = await deps.resolveBrowser(browserToken)
            if (!user) throw new SkillAuthError(HTTP_STATUS.UNAUTHORIZED, 'login_required')
            const grants = await store.list(user.id, { cursor, now: now() })
            const page = grants.slice(0, SKILL_AUTH.devicePageSize)
            const last = page.at(-1)
            return {
                nextCursor:
                    grants.length > SKILL_AUTH.devicePageSize && last
                        ? `${last.createdAt}:${last.id}`
                        : null,
                devices: page.map((grant) => ({
                    id: grant.id,
                    name: grant.deviceName,
                    createdAt: new Date(grant.createdAt).toISOString(),
                    expiresAt:
                        grant.expiresAt === null ? null : new Date(grant.expiresAt).toISOString(),
                })),
            }
        },
        async revoke(id: string, browserToken: string) {
            const user = await deps.resolveBrowser(browserToken)
            if (!user) throw new SkillAuthError(HTTP_STATUS.UNAUTHORIZED, 'login_required')
            return store.update(id, (grant) => {
                if (!grant || grant.userId !== user.id)
                    throw new SkillAuthError(HTTP_STATUS.FORBIDDEN, 'not_your_device')
                return { grant: { ...grant, revoked: true }, result: { revoked: true } }
            })
        },
        async logout(accessToken: string) {
            const grant = await store.find('accessHash', skillDigest(accessToken))
            active(grant)
            const user = await deps.findUser(grant.userId)
            if (user?.isAnonymous)
                throw new SkillAuthError(HTTP_STATUS.FORBIDDEN, 'anonymous_no_logout')
            return store.update(grant.id, (current) => ({
                grant: current ? { ...current, revoked: true } : null,
                result: { revoked: true },
            }))
        },
        async anonymous(deviceToken: string, deviceName: string, machineId: string, ip: string) {
            await throttle('anonymous:' + ip)
            if (!deps.createAnonymous)
                throw new SkillAuthError(HTTP_STATUS.SERVICE_UNAVAILABLE, 'anonymous_unavailable')
            const id = skillDigest(deviceToken)
            const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(
                new Date(now()),
            )
            const userId = await store.reserveAnonymous(
                id,
                skillDigest(ip),
                machineId,
                day,
                deps.debug === true,
            )
            if (!userId) throw new SkillAuthError(HTTP_STATUS.TOO_MANY_REQUESTS, 'anonymous_limit')
            const user = await deps.createAnonymous(userId)
            if (!(await store.find('id', id)))
                await store.insert({
                    id,
                    codeHash: id,
                    deviceName,
                    createdAt: now(),
                    pendingUntil: now(),
                    userId: user.id,
                    expiresAt: null,
                    revoked: false,
                    accessHash: null,
                    accessUntil: 0,
                })
            return { user }
        },
        async start(deviceToken: string, deviceName: string, ip: string) {
            await throttle('start:' + ip)
            const id = skillDigest(deviceToken)
            const userCode = randomBytes(SKILL_AUTH.codeBytes).toString('hex').toUpperCase()
            const existing = await store.find('id', id)
            if (existing) throw new SkillAuthError(HTTP_STATUS.CONFLICT, 'challenge_exists')
            await store.insert({
                id,
                codeHash: skillDigest(userCode),
                deviceName,
                createdAt: now(),
                pendingUntil: now() + SKILL_AUTH.pendingMs,
                userId: null,
                expiresAt: null,
                revoked: false,
                accessHash: null,
                accessUntil: 0,
            })
            return {
                userCode,
                verificationUrl: deps.origin + '/skill/authorize',
                expiresIn: SKILL_AUTH.pendingMs,
                interval: SKILL_AUTH.pollMs,
            }
        },
        async approve(userCode: string, remember: boolean, browserToken: string, ip: string) {
            await throttle('approve:' + ip)
            const user = await deps.resolveBrowser(browserToken)
            if (!user) throw new SkillAuthError(HTTP_STATUS.UNAUTHORIZED, 'login_required')
            const found = await store.find('codeHash', skillDigest(userCode))
            if (!found) throw new SkillAuthError(HTTP_STATUS.BAD_REQUEST, 'invalid_user_code')
            return store.update(found.id, (grant) => {
                if (
                    !grant ||
                    grant.revoked ||
                    (grant.expiresAt !== null && grant.expiresAt <= now()) ||
                    (grant.userId !== null && grant.userId !== user.id) ||
                    (grant.userId === null && grant.pendingUntil <= now())
                )
                    throw new SkillAuthError(HTTP_STATUS.BAD_REQUEST, 'invalid_user_code')
                // 已批准的同账号重试只恢复原结果，不延长临时期限或升级长期授权。
                const expiresAt = grant.userId
                    ? grant.expiresAt
                    : remember
                      ? null
                      : now() + SKILL_AUTH.temporaryMs
                return {
                    grant: { ...grant, userId: user.id, expiresAt },
                    result: {
                        approved: true,
                        expiresAt: expiresAt === null ? null : new Date(expiresAt).toISOString(),
                    },
                }
            })
        },
        async token(deviceToken: string, ip: string) {
            await throttle('token-ip:' + ip)
            const id = skillDigest(deviceToken)
            await throttle('token:' + id)
            const found = await store.find('id', id)
            active(found)
            const user = await deps.findUser(found.userId)
            if (!user) throw new SkillAuthError(HTTP_STATUS.UNAUTHORIZED, 'authorization_expired')
            const accessToken =
                SKILL_AUTH.accessPrefix + randomBytes(SKILL_AUTH.secretBytes).toString('hex')
            return store.update(id, (grant) => {
                active(grant)
                const accessUntil = Math.min(
                    now() + SKILL_AUTH.accessMs,
                    grant.expiresAt ?? Infinity,
                )
                return {
                    grant: { ...grant, accessHash: skillDigest(accessToken), accessUntil },
                    result: {
                        accessToken,
                        accessExpiresAt: new Date(accessUntil).toISOString(),
                        user,
                        expiresAt:
                            grant.expiresAt === null
                                ? null
                                : new Date(grant.expiresAt).toISOString(),
                    },
                }
            })
        },
        async authenticate(accessToken: string) {
            const grant = await store.find('accessHash', skillDigest(accessToken))
            active(grant)
            if (grant.accessUntil <= now())
                throw new SkillAuthError(HTTP_STATUS.UNAUTHORIZED, 'access_expired')
            const user = await deps.findUser(grant.userId)
            if (!user) throw new SkillAuthError(HTTP_STATUS.UNAUTHORIZED, 'authorization_expired')
            return { user, authSessionKey: 'skill:' + grant.id }
        },
    }
}
export type SkillAuthService = ReturnType<typeof createSkillAuthService>
