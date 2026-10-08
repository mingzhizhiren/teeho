type ObservationErrorCategory =
    | 'database_constraint'
    | 'connection'
    | 'timeout'
    | 'database'
    | 'unknown'

const MAX_ERROR_CAUSE_DEPTH = 4
const CONNECTION_ERROR_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EPIPE'])

/** 只输出固定分类；驱动包装异常的 message、query、params 和任意名称均不进入日志。 */
export function analysisObservationErrorCategory(error: unknown): ObservationErrorCategory {
    let current = error
    for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH; depth += 1) {
        if (typeof current !== 'object' || current === null) break
        const code = 'code' in current ? current.code : undefined
        if (typeof code === 'string') {
            if (CONNECTION_ERROR_CODES.has(code) || /^08[A-Z0-9]{3}$/u.test(code))
                return 'connection'
            if (code === 'ETIMEDOUT') return 'timeout'
            if (/^23[A-Z0-9]{3}$/u.test(code)) return 'database_constraint'
            if (/^[0-9]{2}[A-Z0-9]{3}$/u.test(code)) return 'database'
        }
        current = 'cause' in current ? current.cause : undefined
    }
    return 'unknown'
}
