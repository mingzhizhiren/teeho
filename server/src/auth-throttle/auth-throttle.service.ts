import { createHmac } from 'node:crypto'

import { env } from '../config/env'
import { logger } from '../utils/logger'
import { authThrottleConstraints, type AuthThrottleScope } from './auth-throttle.constants'
import {
    clearLoginThrottle,
    hasActiveLoginThrottle,
    recordLoginThrottleFailure,
    type AuthThrottleFailureKey,
    type AuthThrottleKey,
} from './auth-throttle.repository'

export interface LoginThrottleContext {
    clientIp: string | null
    deviceToken: string | null
}

function hashThrottleKey(scope: AuthThrottleScope, value: string) {
    return createHmac('sha256', env.TEEHO_PWD)
        .update(`auth-throttle:${scope}:${value}`)
        .digest('hex')
}

function identifierKey(email: string): AuthThrottleKey {
    return {
        scope: 'identifier',
        keyHash: hashThrottleKey('identifier', email.trim().toLowerCase()),
    }
}

function createThrottleKeys(email: string, context: LoginThrottleContext) {
    const keys: AuthThrottleKey[] = [identifierKey(email)]
    if (context.deviceToken) {
        keys.push({
            scope: 'device',
            keyHash: hashThrottleKey('device', context.deviceToken),
        })
    }
    if (context.clientIp) {
        keys.push({
            scope: 'ip',
            keyHash: hashThrottleKey('ip', context.clientIp),
        })
    }
    return keys
}

async function failOpen<T>(operation: () => Promise<T>, fallback: T, action: string) {
    try {
        return await operation()
    } catch (error) {
        logger.warn(
            {
                event: 'auth_throttle_fail_open',
                err: error,
                operation: action,
            },
            '登录限流操作失败，按可用性策略继续认证',
        )
        return fallback
    }
}

/** 在调用 Supabase Auth 前检查多维登录限制。 */
export async function isLoginAttemptBlocked(email: string, context: LoginThrottleContext) {
    return failOpen(() => hasActiveLoginThrottle(createThrottleKeys(email, context)), false, '检查')
}

/** 记录一次确定的无效凭据；返回本次是否达到任一限制阈值。 */
export async function recordLoginFailure(email: string, context: LoginThrottleContext) {
    const keys: AuthThrottleFailureKey[] = createThrottleKeys(email, context).map((key) => ({
        ...key,
        attemptLimit: authThrottleConstraints.attemptLimits[key.scope],
    }))
    return failOpen(
        () =>
            recordLoginThrottleFailure(
                keys,
                authThrottleConstraints.observationWindowMs,
                authThrottleConstraints.lockDurationMs,
            ),
        false,
        '写入',
    )
}

/** 登录成功后清除账号维度，设备和 IP 的全局失败窗口按时间自然过期。 */
export async function clearLoginIdentifierThrottle(email: string) {
    await failOpen(() => clearLoginThrottle(identifierKey(email)), undefined, '清理')
}
