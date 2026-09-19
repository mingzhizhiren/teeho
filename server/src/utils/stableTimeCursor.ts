import { z } from 'zod'

/** URL-safe 稳定时间游标允许的最大字符数。 */
export const STABLE_TIME_CURSOR_MAXIMUM_LENGTH = 512

const storedStableTimeCursorSchema = z
    .object({
        t: z.string().datetime({ offset: true }),
        i: z.string().uuid(),
    })
    .strict()

/** 由创建时间和稳定 UUID 组成的倒序分页位置。 */
export interface StableTimeCursorPosition {
    createdAt: string
    id: string
}

/** 将稳定时间位置编码为不透明的 URL-safe 游标。 */
export function encodeStableTimeCursor(position: StableTimeCursorPosition) {
    return Buffer.from(JSON.stringify({ t: position.createdAt, i: position.id }), 'utf8').toString(
        'base64url',
    )
}

/** 严格解码稳定时间游标；非法、过长或旧结构返回 null。 */
export function decodeStableTimeCursor(cursor: string): StableTimeCursorPosition | null {
    if (!cursor || cursor.length > STABLE_TIME_CURSOR_MAXIMUM_LENGTH) return null
    try {
        const parsed = storedStableTimeCursorSchema.safeParse(
            JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
        )
        return parsed.success ? { createdAt: parsed.data.t, id: parsed.data.i } : null
    } catch {
        return null
    }
}
