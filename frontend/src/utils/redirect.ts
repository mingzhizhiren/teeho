import { z } from 'zod'

const safeRedirectSchema = z
    .string()
    .startsWith('/')
    .refine((value) => !value.startsWith('//') && !/[\\\u0000-\u001f\u007f]/.test(value))

/** 将外部跳转参数约束为站内绝对路径 */
export function resolveSafeRedirect(value: unknown, fallback = '/workspace') {
    const parsed = safeRedirectSchema.safeParse(value)
    return parsed.success ? parsed.data : fallback
}
