import { createClient, type AuthError } from '@supabase/supabase-js'

import { env } from '../config/env'
import type { ChangePasswordParam, RegisterParam } from './auth.schema'

interface PasswordLoginParam {
    email: string
    password: string
}

interface PkceStorage {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
    removeItem(key: string): void
    isServer: true
}

/** 创建保存 PKCE 校验信息的临时存储适配器 */
function createPkceStorage(initialCodeVerifier = '') {
    let codeVerifier = initialCodeVerifier
    const storage: PkceStorage = {
        isServer: true,
        getItem: (key) => (key.endsWith('-code-verifier') ? codeVerifier || null : null),
        setItem: (key, value) => {
            if (key.endsWith('-code-verifier')) {
                codeVerifier = value
            }
        },
        removeItem: (key) => {
            if (key.endsWith('-code-verifier')) {
                codeVerifier = ''
            }
        },
    }

    return { storage, readCodeVerifier: () => codeVerifier }
}

/** 创建面向当前认证请求的 Supabase 客户端 */
function createAuthClient(options: { flowType?: 'implicit' | 'pkce'; storage?: PkceStorage } = {}) {
    return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
        auth: {
            autoRefreshToken: false,
            detectSessionInUrl: false,
            flowType: options.flowType ?? 'implicit',
            persistSession: options.storage !== undefined,
            storage: options.storage,
        },
    })
}

/** 使用 Supabase Auth 校验后端已解析的邮箱与密码 */
export function signInWithPassword(param: PasswordLoginParam) {
    return createAuthClient().auth.signInWithPassword(param)
}

/** 使用 Supabase Auth 创建邮箱密码账号 */
export function signUpWithPassword(param: RegisterParam) {
    return createAuthClient().auth.signUp(param)
}

/** 创建 Google OAuth PKCE 授权地址与一次性校验器 */
export async function createGoogleAuthorization(redirectTo: string) {
    const pkceStorage = createPkceStorage()
    const client = createAuthClient({ flowType: 'pkce', storage: pkceStorage.storage })
    const result = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true },
    })

    return { ...result, codeVerifier: pkceStorage.readCodeVerifier() }
}

/** 使用一次性 PKCE 校验器交换 Google OAuth 会话 */
export function exchangeGoogleAuthorizationCode(code: string, codeVerifier: string) {
    const pkceStorage = createPkceStorage(codeVerifier)
    return createAuthClient({
        flowType: 'pkce',
        storage: pkceStorage.storage,
    }).auth.exchangeCodeForSession(code)
}

/** 使用一次性 refresh token 轮换会话 */
export function refreshSession(refreshToken: string) {
    return createAuthClient().auth.refreshSession({ refresh_token: refreshToken })
}

/** 通过 Supabase Auth 服务验证 access token 并读取用户 */
export function getUser(accessToken: string) {
    return createAuthClient().auth.getUser(accessToken)
}

/** 撤销当前 Supabase 会话 */
export async function signOut(accessToken: string, refreshToken: string) {
    const client = createAuthClient()
    const { error } = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
    })

    if (error) {
        return { error }
    }

    return client.auth.signOut({ scope: 'local' })
}

export type PasswordUpdateStage = 'verify' | 'update' | 'revoke' | 'complete'

export interface PasswordUpdateRepositoryResult {
    error: AuthError | null
    stage: PasswordUpdateStage
    resultUnknown: boolean
    transportFailed: boolean
    identityMismatch: boolean
}

async function runPasswordUpdateStage(
    stage: 'update' | 'revoke',
    operation: () => Promise<{ error: AuthError | null }>,
): Promise<PasswordUpdateRepositoryResult> {
    try {
        const result = await operation()
        return {
            error: result.error,
            stage,
            resultUnknown: stage === 'revoke' && result.error !== null,
            transportFailed: false,
            identityMismatch: false,
        }
    } catch {
        return {
            error: null,
            stage,
            resultUnknown: true,
            transportFailed: true,
            identityMismatch: false,
        }
    }
}

/** 使用当前会话和当前密码更新凭证，并撤销该账号全部刷新会话。 */
export async function updatePassword(
    param: Pick<ChangePasswordParam, 'currentPassword' | 'newPassword'> & {
        userId: string
        email: string
    },
) {
    const client = createAuthClient()
    let verification: Awaited<ReturnType<typeof client.auth.signInWithPassword>>
    try {
        verification = await client.auth.signInWithPassword({
            email: param.email,
            password: param.currentPassword,
        })
    } catch {
        return {
            error: null,
            stage: 'verify',
            resultUnknown: false,
            transportFailed: true,
            identityMismatch: false,
        } satisfies PasswordUpdateRepositoryResult
    }
    if (verification.error) {
        return {
            error: verification.error,
            stage: 'verify',
            resultUnknown: false,
            transportFailed: false,
            identityMismatch: false,
        } satisfies PasswordUpdateRepositoryResult
    }
    if (!verification.data.session || verification.data.session.user.id !== param.userId) {
        return {
            error: null,
            stage: 'verify',
            resultUnknown: false,
            transportFailed: false,
            identityMismatch: true,
        } satisfies PasswordUpdateRepositoryResult
    }

    const updated = await runPasswordUpdateStage('update', () =>
        client.auth.updateUser({
            password: param.newPassword,
            current_password: param.currentPassword,
        }),
    )
    if (updated.error || updated.transportFailed) return updated

    const revoked = await runPasswordUpdateStage('revoke', () =>
        client.auth.signOut({ scope: 'global' }),
    )
    if (revoked.error || revoked.transportFailed) return revoked
    return {
        error: null,
        stage: 'complete',
        resultUnknown: false,
        transportFailed: false,
        identityMismatch: false,
    }
}
