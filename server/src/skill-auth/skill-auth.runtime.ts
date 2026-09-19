import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { env } from '../config/env'
import { getCurrentUser, type AuthUser } from '../auth/auth.service'
import { PostgresSkillStore } from './skill-auth.repository'
import { createSkillAuthController } from './skill-auth.controller'
import { createSkillAuthService } from './skill-auth.service'
import { SkillAuthError } from './skill-auth.contract'
import { HTTP_STATUS } from '../config/constants'

/** 独立用户管理客户端，不保存Supabase浏览器会话。 */
export function skillIdentityClient() {
    return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
}
async function findUser(id: string): Promise<AuthUser | null> {
    const result = await skillIdentityClient().auth.admin.getUserById(id)
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
    error: { status?: number; code?: string },
): Error & {
    status?: number
    code?: string
} {
    const failure = new Error(reason) as Error & { status?: number; code?: string }
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
