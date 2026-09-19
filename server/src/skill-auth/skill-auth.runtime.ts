import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { env } from '../config/env'
import { getCurrentUser, type AuthUser } from '../auth/auth.service'
import { PostgresSkillStore } from './skill-auth.repository'
import { createSkillAuthController } from './skill-auth.controller'
import { createSkillAuthService } from './skill-auth.service'
import { SkillAuthError } from './skill-auth.contract'
import { HTTP_STATUS } from '../config/constants'
import { logger } from '../utils/logger'

const identityReadPolicy = { maximumAttempts: 3, retryDelayMs: 200 }
const transientIdentityStatus = {
    networkFailure: 0,
    badGateway: HTTP_STATUS.BAD_GATEWAY,
    unavailable: HTTP_STATUS.SERVICE_UNAVAILABLE,
    gatewayTimeout: 504,
}
const transientIdentityStatuses = new Set<number>(Object.values(transientIdentityStatus))
const safeProviderErrorNames = new Set([
    'AuthApiError',
    'AuthRetryableFetchError',
    'AuthUnknownError',
])

/** 独立用户管理客户端，不保存Supabase浏览器会话。 */
export function skillIdentityClient() {
    return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
}
/** 只重试无副作用的账号查询；匿名创建和授权写入不在重试范围。 */
async function readIdentity(id: string) {
    let result = await skillIdentityClient().auth.admin.getUserById(id)
    for (
        let attempt = 1;
        attempt < identityReadPolicy.maximumAttempts &&
        result.error &&
        transientIdentityStatuses.has(result.error.status ?? -1);
        attempt++
    ) {
        logger.warn(
            {
                event: 'skill_identity_read_retry',
                attempt,
                providerStatus: result.error.status,
            },
            'Skill身份查询暂时失败，重试只读请求',
        )
        await new Promise((resolve) =>
            setTimeout(resolve, identityReadPolicy.retryDelayMs * attempt),
        )
        result = await skillIdentityClient().auth.admin.getUserById(id)
    }
    return result
}

async function findUser(id: string): Promise<AuthUser | null> {
    const result = await readIdentity(id)
    if (result.error && result.error.status !== HTTP_STATUS.NOT_FOUND)
        throw providerError('identity_provider_unavailable', result.error)
    if (!result.data.user) return null
    const user = result.data.user
    const bannedUntil = (user as typeof user & { banned_until?: string }).banned_until
    if (bannedUntil && Date.parse(bannedUntil) > Date.now()) return null
    return {
        id: user.id,
        email: user.email ?? null,
        isAnonymous: Boolean(user.app_metadata.teeho_skill_anonymous),
        canChangePassword:
            !user.app_metadata.teeho_skill_anonymous &&
            Boolean(user.identities?.some((identity) => identity.provider === 'email')),
    }
}
async function createAnonymous(id: string): Promise<AuthUser> {
    const existing = await findUser(id)
    if (existing) {
        if (!existing.isAnonymous) throw new Error('anonymous_identity_conflict')
        return existing
    }
    const secretBytes = 32
    const result = await skillIdentityClient().auth.admin.createUser({
        id,
        email: `anonymous@anonymous-${id}.teeho`,
        password: randomBytes(secretBytes).toString('hex'),
        email_confirm: true,
        app_metadata: { teeho_skill_anonymous: true },
    })
    // 响应丢失或并发创建可通过预留的固定账号ID恢复。
    if (result.error && !(await findUser(id)))
        throw providerError('anonymous_provider_unavailable', result.error)
    const user = await findUser(id)
    if (!user?.isAnonymous) throw new Error('anonymous_provider_unavailable')
    return user
}

function providerError(
    reason: string,
    error: { status?: number; code?: string; name?: string },
): Error & {
    status?: number
    code?: string
} {
    const failure = new Error(reason) as Error & { status?: number; code?: string }
    if (error.name && safeProviderErrorNames.has(error.name)) failure.name = error.name
    if (typeof error.status === 'number') failure.status = error.status
    if (typeof error.code === 'string' && /^[a-zA-Z0-9_-]{1,32}$/u.test(error.code))
        failure.code = error.code
    return failure
}
const dependencies = {
    debug: env.DEBUG,
    store: new PostgresSkillStore(),
    now: Date.now,
    origin: env.CORS_ORIGIN || new URL(env.PUBLIC_API_URL || 'http://localhost:5173').origin,
    resolveBrowser: async (token: string) => {
        const result = await getCurrentUser(token)
        return result.success ? result.data : null
    },
    findUser,
    createAnonymous,
}
export const skillAuthController = createSkillAuthController(dependencies)
const service = createSkillAuthService(dependencies)
/** 验证设备访问凭据，并实时检查账号和撤销状态。 */
export async function authenticateSkillToken(token: string) {
    try {
        return await service.authenticate(token)
    } catch (error) {
        if (error instanceof SkillAuthError) return null
        throw error
    }
}
