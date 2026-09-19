import {
    ApiRequestError,
    getApiRequestErrorMessage,
} from '@/utils/apiRequestError'

export type PasswordChangeFeedbackField = 'current' | 'new' | 'form'

export interface PasswordChangeFeedback {
    readonly field: PasswordChangeFeedbackField
    readonly message: string
}

function errorReason(error: ApiRequestError): string | null {
    if (typeof error.data !== 'object' || error.data === null) return null
    const reason = Reflect.get(error.data, 'reason')
    return typeof reason === 'string' ? reason : null
}

/** 把受控改密错误映射到最小可修复范围，未知错误保留在表单。 */
export function resolvePasswordChangeFeedback(
    error: unknown,
    fallbackMessage: string,
): PasswordChangeFeedback {
    const reason = error instanceof ApiRequestError ? errorReason(error) : null
    const field: PasswordChangeFeedbackField =
        reason === 'password_change_invalid_current_password'
            ? 'current'
            : reason === 'password_change_invalid_new_password'
              ? 'new'
              : 'form'
    return {
        field,
        message: getApiRequestErrorMessage(error, fallbackMessage),
    }
}
