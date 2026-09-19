import { TIME_MS } from '../config/constants'

const observationWindowMinutes = 15

/** 修改当前密码的独立失败窗口，不与普通登录共享表、键或清理语义。 */
export const passwordChangeThrottleConstraints = {
    observationWindowMs: observationWindowMinutes * TIME_MS.MINUTE,
    attemptLimits: {
        account: 5,
        ip: 20,
    },
} as const

export type PasswordChangeThrottleScope =
    keyof typeof passwordChangeThrottleConstraints.attemptLimits

export const passwordChangeThrottleMessage = '当前密码错误次数过多，请 15 分钟后再试'
