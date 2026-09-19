import { ApiRequestError } from '@/utils/apiRequestError'

export interface PasswordChangeInput {
    currentPassword: string
    newPassword: string
    confirmPassword: string
}

export interface PasswordChangeSessionAdapter {
    requestPasswordChange(input: PasswordChangeInput): Promise<void>
    endLocalSession(): void
}

export type PasswordChangeSessionOutcome = {
    kind: 'session_ended'
    reason: 'changed' | 'result_unknown' | 'session_invalid'
}

function readReason(data: unknown): string | null {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
    const reason = Reflect.get(data, 'reason')
    return typeof reason === 'string' ? reason : null
}

function resolveSessionEndReason(
    error: unknown,
): Exclude<PasswordChangeSessionOutcome['reason'], 'changed'> | null {
    if (!(error instanceof ApiRequestError)) return 'result_unknown'
    if (error.status === null) return 'result_unknown'

    const reason = readReason(error.data)
    if (reason === 'password_change_result_unknown') return 'result_unknown'
    if (reason === 'password_change_session_invalid') return 'session_invalid'
    return null
}

/** 修改密码请求最多发送一次；成功或结果未知都直接结束本地会话。 */
export function createPasswordChangeSessionFlow(adapter: PasswordChangeSessionAdapter) {
    return {
        async execute(input: PasswordChangeInput): Promise<PasswordChangeSessionOutcome> {
            try {
                await adapter.requestPasswordChange(input)
                adapter.endLocalSession()
                return { kind: 'session_ended', reason: 'changed' }
            } catch (error) {
                const reason = resolveSessionEndReason(error)
                if (!reason) throw error
                adapter.endLocalSession()
                return { kind: 'session_ended', reason }
            }
        },
    }
}
