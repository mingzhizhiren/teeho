import { createHmac } from 'node:crypto'

import { env } from '../config/env'
import { logger } from '../utils/logger'
import {
    passwordChangeThrottleConstraints,
    type PasswordChangeThrottleScope,
} from './auth-password-change.constants'
import {
    hasActivePasswordChangeThrottle,
    recordPasswordChangeFailure,
    type PasswordChangeFailureKey,
    type PasswordChangeThrottleKey,
} from './auth-password-change.repository'

export interface PasswordChangeThrottleContext {
    userId: string
    clientIp: string | null
}

export type PasswordChangeThrottleDecision = 'allowed' | 'limited' | 'unavailable'

function hashThrottleKey(scope: PasswordChangeThrottleScope, value: string): string {
    return createHmac('sha256', env.TEEHO_PWD)
        .update(`auth-password-change:${scope}:${value}`)
        .digest('hex')
}

function createThrottleKeys(context: PasswordChangeThrottleContext): PasswordChangeThrottleKey[] {
    const accountKey: PasswordChangeThrottleKey = {
        scope: 'account',
        keyHash: hashThrottleKey('account', context.userId),
    }
    if (!context.clientIp) return [accountKey]
    return [
        accountKey,
        {
            scope: 'ip',
            keyHash: hashThrottleKey('ip', context.clientIp),
        },
    ]
}

function logThrottleFailure(operation: 'check' | 'record', error: unknown): void {
    logger.warn(
        {
            event: 'auth_password_change_throttle_unavailable',
            operation,
            errorName: error instanceof Error ? error.name : 'UnknownError',
        },
        '修改密码限流不可用，按安全策略拒绝操作',
    )
}

/** 检查独立失败窗口；存储故障时 fail closed。 */
export async function checkPasswordChangeThrottle(
    context: PasswordChangeThrottleContext,
): Promise<PasswordChangeThrottleDecision> {
    try {
        return (await hasActivePasswordChangeThrottle(createThrottleKeys(context)))
            ? 'limited'
            : 'allowed'
    } catch (error) {
        logThrottleFailure('check', error)
        return 'unavailable'
    }
}

/** 只在 Provider 明确确认当前密码错误后累计；存储故障时 fail closed。 */
export async function recordInvalidCurrentPassword(
    context: PasswordChangeThrottleContext,
): Promise<PasswordChangeThrottleDecision> {
    const keys: PasswordChangeFailureKey[] = createThrottleKeys(context).map((key) => ({
        ...key,
        attemptLimit: passwordChangeThrottleConstraints.attemptLimits[key.scope],
    }))
    try {
        return (await recordPasswordChangeFailure(
            keys,
            passwordChangeThrottleConstraints.observationWindowMs,
        ))
            ? 'limited'
            : 'allowed'
    } catch (error) {
        logThrottleFailure('record', error)
        return 'unavailable'
    }
}
