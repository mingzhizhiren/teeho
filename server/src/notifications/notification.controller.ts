import { API_CODES, HTTP_STATUS } from '../config/constants'
import { fail, ok } from '../utils/response'
import { decodeNotificationCursor } from './notification.cursor'
import { businessNotificationIdSchema, notificationListQuerySchema } from './notification.schema'
import {
    getNotificationPage,
    markAllNotificationsRead,
    markNotificationRead,
} from './notification.service'

/** 校验游标分页参数并返回当前账号的通知页。 */
export async function handleGetNotifications(userId: string, query: unknown) {
    const parsedQuery = notificationListQuerySchema.safeParse(query)
    if (!parsedQuery.success) {
        return {
            status: HTTP_STATUS.BAD_REQUEST,
            response: fail(API_CODES.VALIDATION_ERROR, '通知分页参数无效'),
        }
    }
    const cursor = parsedQuery.data.cursor
        ? decodeNotificationCursor(parsedQuery.data.cursor)
        : null
    if (parsedQuery.data.cursor && !cursor) {
        return {
            status: HTTP_STATUS.BAD_REQUEST,
            response: fail(API_CODES.VALIDATION_ERROR, '通知游标无效'),
        }
    }
    return {
        status: HTTP_STATUS.OK,
        response: ok(
            await getNotificationPage(userId, {
                cursor,
                limit: parsedQuery.data.limit,
            }),
        ),
    }
}

/** 校验标识并标记当前账号自己的通知为已读。 */
export async function handleReadNotification(userId: string, notificationId: unknown) {
    const parsedId = businessNotificationIdSchema.safeParse(notificationId)
    if (!parsedId.success) {
        return {
            status: HTTP_STATUS.BAD_REQUEST,
            response: fail(API_CODES.VALIDATION_ERROR, '通知标识无效'),
        }
    }

    const result = await markNotificationRead(userId, parsedId.data)
    if (!result) {
        return {
            status: HTTP_STATUS.NOT_FOUND,
            response: fail(API_CODES.NOT_FOUND, '通知不存在'),
        }
    }
    return { status: HTTP_STATUS.OK, response: ok(result) }
}

/** 标记当前账号的全部未读业务通知为已读。 */
export async function handleReadAllNotifications(userId: string) {
    return {
        status: HTTP_STATUS.OK,
        response: ok(await markAllNotificationsRead(userId)),
    }
}
