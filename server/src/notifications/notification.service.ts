import { withTransaction } from '../db/database'
import type { NotificationCursorPosition } from './notification.cursor'
import {
    countUnreadNotifications,
    findNotificationPage,
    readAllNotifications,
    readNotification,
} from './notification.repository'

/** 获取当前账号的一页通知和独立的全部未读总数。 */
export function getNotificationPage(
    userId: string,
    options: { cursor: NotificationCursorPosition | null; limit: number },
) {
    return withTransaction(async (transaction) => {
        const page = await findNotificationPage(userId, options, transaction)
        const unreadCount = await countUnreadNotifications(userId, transaction)
        return { ...page, unreadCount }
    })
}

/** 幂等标记当前账号通知已读，并返回最新全部未读总数。 */
export function markNotificationRead(userId: string, notificationId: string) {
    return withTransaction(async (transaction) => {
        const notification = await readNotification(userId, notificationId, transaction)
        if (!notification) {
            return null
        }
        return {
            notification,
            unreadCount: await countUnreadNotifications(userId, transaction),
        }
    })
}

/** 标记当前账号全部未读通知，并在同一事务返回更新数和新未读总数。 */
export function markAllNotificationsRead(userId: string) {
    return withTransaction(async (transaction) => ({
        updatedCount: await readAllNotifications(userId, transaction),
        unreadCount: await countUnreadNotifications(userId, transaction),
    }))
}
