import {
    decodeStableTimeCursor,
    encodeStableTimeCursor,
    type StableTimeCursorPosition,
} from '../utils/stableTimeCursor'

/** 通知列表的稳定时间游标位置。 */
export type NotificationCursorPosition = StableTimeCursorPosition

/** 把稳定排序位置编码为不暴露字段契约的 URL-safe 游标。 */
export function encodeNotificationCursor(position: NotificationCursorPosition) {
    return encodeStableTimeCursor(position)
}

/** 严格解码通知游标；非法、过长或旧结构一律由调用方作为参数错误处理。 */
export function decodeNotificationCursor(cursor: string): NotificationCursorPosition | null {
    return decodeStableTimeCursor(cursor)
}
