import { TIME_MS } from '../config/constants'

const observationWindowMinutes = 5
const lockDurationMinutes = 5
const deviceTokenLifetimeDays = 90

/** 邮箱密码登录的多维限流规则。 */
export const authThrottleConstraints = {
    observationWindowMs: observationWindowMinutes * TIME_MS.MINUTE,
    lockDurationMs: lockDurationMinutes * TIME_MS.MINUTE,
    deviceTokenLifetimeSeconds: (deviceTokenLifetimeDays * TIME_MS.DAY) / TIME_MS.SECOND,
    tokenIdBytes: 32,
    tokenSignatureBytes: 32,
    tokenPartBase64UrlLength: 43,
    keyHashHexLength: 64,
    attemptLimits: {
        identifier: 5,
        device: 10,
        ip: 20,
    },
} as const

/** 对外统一的登录限流提示，不暴露账号是否存在或命中的维度。 */
export const loginThrottleMessage = '登录尝试过多，请 5 分钟后再试'

/** 登录限流维度。 */
export type AuthThrottleScope = keyof typeof authThrottleConstraints.attemptLimits
