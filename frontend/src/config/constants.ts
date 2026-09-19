/** 浏览器端统一时间单位。 */
export const TIME_MS = {
    SECOND: 1_000,
    MINUTE: 60_000,
    HOUR: 3_600_000,
    DAY: 86_400_000,
} as const

/** 浏览器端统一秒数单位。 */
export const TIME_SECONDS = {
    MINUTE: 60,
    HOUR: 3_600,
} as const

/** 二进制容量单位。 */
export const BYTE_SIZE = {
    KIBIBYTE: 1_024,
    MEBIBYTE: 1_048_576,
} as const

/** 前端需要显式分支处理的 HTTP 状态。 */
export const HTTP_STATUS = {
    SUCCESS_MIN: 200,
    REDIRECTION_MIN: 300,
    BAD_REQUEST: 400,
    NOT_FOUND: 404,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    TOO_MANY_REQUESTS: 429,
    SERVICE_UNAVAILABLE: 503,
} as const

/** 前端需要读取结构化恢复数据的业务错误码。 */
export const API_CODES = {
    RATE_LIMITED: 4290,
    SERVICE_MAINTENANCE: 5030,
} as const

const authRequestTimeoutSeconds = 60

/** Supabase Auth 使用独立等待窗口，避免远端已成功但浏览器先误报失败。 */
export const AUTH_UI = {
    REQUEST_TIMEOUT_MS: authRequestTimeoutSeconds * TIME_MS.SECOND,
} as const
