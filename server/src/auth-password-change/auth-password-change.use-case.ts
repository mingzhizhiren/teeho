import type { ChangePasswordParam } from '../auth/auth.schema'
import type { AuthUser } from '../auth/auth.service'
import type { PasswordChangeCoordinator } from './auth-password-change.coordinator'
import type {
    PasswordChangeThrottleContext,
    PasswordChangeThrottleDecision,
} from './auth-password-change.throttle'

export type CredentialChangeFailureReason =
    | 'invalid_current_password'
    | 'invalid_new_password'
    | 'session_invalid'
    | 'account_forbidden'
    | 'provider_rate_limited'
    | 'provider_unavailable'
    | 'result_unknown'

interface AccountResolution {
    success: boolean
    data?: AuthUser
}

interface CredentialChangeResult {
    success: boolean
    data?: { userId: string }
    reason?: CredentialChangeFailureReason
}

export interface PasswordChangeUseCaseDependencies {
    resolveAccount(accessToken: string): Promise<AccountResolution>
    updateCredential(
        accessToken: string,
        refreshToken: string,
        password: ChangePasswordParam,
    ): Promise<CredentialChangeResult>
    checkThrottle(context: PasswordChangeThrottleContext): Promise<PasswordChangeThrottleDecision>
    recordInvalidPassword(
        context: PasswordChangeThrottleContext,
    ): Promise<PasswordChangeThrottleDecision>
    invalidateAgentTurn(userId: string, accessToken: string): Promise<unknown>
    coordinator: PasswordChangeCoordinator
}

export interface PasswordChangeUseCaseInput {
    accessToken: string
    refreshToken: string
    clientIp: string | null
    password: ChangePasswordParam
}

export type PasswordChangeUseCaseOutcome =
    | { kind: 'changed' }
    | { kind: 'invalid_current_password' }
    | { kind: 'invalid_new_password' }
    | { kind: 'session_invalid' }
    | { kind: 'account_forbidden' }
    | { kind: 'provider_rate_limited' }
    | { kind: 'provider_unavailable' }
    | { kind: 'result_unknown' }
    | { kind: 'rate_limited' }
    | { kind: 'in_progress' }

export interface PasswordChangeUseCase {
    execute(input: PasswordChangeUseCaseInput): Promise<PasswordChangeUseCaseOutcome>
}

function mapCredentialFailure(result: CredentialChangeResult): PasswordChangeUseCaseOutcome {
    const supportedReasons: readonly CredentialChangeFailureReason[] = [
        'invalid_current_password',
        'invalid_new_password',
        'session_invalid',
        'account_forbidden',
        'provider_rate_limited',
        'provider_unavailable',
        'result_unknown',
    ]
    return result.reason && supportedReasons.includes(result.reason)
        ? { kind: result.reason }
        : { kind: 'provider_unavailable' }
}

/** 可替换依赖的 Auth 修改密码深 Module Interface。 */
export function createPasswordChangeUseCase(
    dependencies: PasswordChangeUseCaseDependencies,
): PasswordChangeUseCase {
    return {
        async execute(input) {
            const account = await dependencies.resolveAccount(input.accessToken)
            if (!account.success || !account.data) return { kind: 'session_invalid' }
            if (!account.data.canChangePassword) return { kind: 'account_forbidden' }

            try {
                const coordinated = await dependencies.coordinator.run(
                    account.data.id,
                    async () => {
                        const throttleContext = {
                            userId: account.data!.id,
                            clientIp: input.clientIp,
                        }
                        const admission = await dependencies.checkThrottle(throttleContext)
                        if (admission === 'limited') return { kind: 'rate_limited' } as const
                        if (admission === 'unavailable') {
                            return { kind: 'provider_unavailable' } as const
                        }

                        let changed: CredentialChangeResult
                        try {
                            changed = await dependencies.updateCredential(
                                input.accessToken,
                                input.refreshToken,
                                input.password,
                            )
                        } catch {
                            return { kind: 'result_unknown' } as const
                        }
                        if (changed.success) {
                            try {
                                await dependencies.invalidateAgentTurn(
                                    account.data!.id,
                                    input.accessToken,
                                )
                            } catch {
                                return { kind: 'result_unknown' } as const
                            }
                            return { kind: 'changed' } as const
                        }
                        if (changed.reason !== 'invalid_current_password') {
                            return mapCredentialFailure(changed)
                        }

                        const recorded = await dependencies.recordInvalidPassword(throttleContext)
                        if (recorded === 'limited') return { kind: 'rate_limited' } as const
                        if (recorded === 'unavailable') {
                            return { kind: 'provider_unavailable' } as const
                        }
                        return { kind: 'invalid_current_password' } as const
                    },
                )

                return coordinated.acquired ? coordinated.value : { kind: 'in_progress' }
            } catch {
                return { kind: 'provider_unavailable' }
            }
        },
    }
}
