import { z } from 'zod'

import { API_CODES, HTTP_STATUS, TIME_MS } from '@/config/constants'
import { ApiRequestError } from '@/utils/apiRequestError'

const draftSendCooldownDataSchema = z
    .object({
        retryAfterSeconds: z.number().int().nonnegative(),
        retryAt: z.string().datetime({ offset: true }),
        reason: z.enum(['rolling_agent_usage']).optional(),
        canUpgrade: z.boolean().optional(),
    })
    .strict()

/** 将权威秒数格式化为用户可读等待时间，不暴露额度的 Token 依据。 */
export function formatAgentCooldownDuration(remainingSeconds: number, locale: 'zh-CN' | 'en-US') {
    const totalMinutes = Math.max(
        1,
        Math.ceil((remainingSeconds * TIME_MS.SECOND) / TIME_MS.MINUTE),
    )
    const minutesPerHour = TIME_MS.HOUR / TIME_MS.MINUTE
    const hours = Math.floor(totalMinutes / minutesPerHour)
    const minutes = totalMinutes % minutesPerHour
    if (locale === 'zh-CN') {
        return [hours > 0 ? `${hours} 小时` : '', minutes > 0 ? `${minutes} 分钟` : '']
            .filter(Boolean)
            .join(' ')
    }
    return [
        hours > 0 ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : '',
        minutes > 0 ? `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}` : '',
    ]
        .filter(Boolean)
        .join(' ')
}

/** 从草稿发送 429 中读取由服务端决定的本地冷却期限。 */
export function resolveDraftSendCooldown(error: unknown, receivedAt = new Date()) {
    if (
        !(error instanceof ApiRequestError) ||
        error.code !== API_CODES.RATE_LIMITED ||
        error.status !== HTTP_STATUS.TOO_MANY_REQUESTS
    ) {
        return null
    }
    const parsed = draftSendCooldownDataSchema.safeParse(error.data)
    if (!parsed.success || parsed.data.retryAfterSeconds <= 0) {
        return null
    }
    const remainingSeconds = parsed.data.retryAfterSeconds
    return {
        reason: parsed.data.reason ?? ('send_window' as const),
        retryAt: parsed.data.retryAt,
        retryAtMs: receivedAt.getTime() + remainingSeconds * TIME_MS.SECOND,
        remainingSeconds,
        waitMinutes: Math.ceil((remainingSeconds * TIME_MS.SECOND) / TIME_MS.MINUTE),
        canUpgrade: parsed.data.canUpgrade ?? false,
    }
}
