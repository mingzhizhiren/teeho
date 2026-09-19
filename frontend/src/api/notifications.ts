import { request, type ApiResponse } from '@/utils/request'

/** 后端允许的受控分析完成通知内容。 */
export interface AnalysisCompletedNotification {
    id: string
    type: 'analysis.completed'
    payload: {
        taskId: string
        resultVersion: number
    }
    createdAt: string
    readAt: string | null
}

/** 通知中心只依赖受控的公共外壳；部署扩展负责解释自己的载荷。 */
export interface BusinessNotification {
    id: string
    type: string
    payload: Readonly<Record<string, unknown>>
    createdAt: string
    readAt: string | null
}

export interface BusinessNotificationPage {
    notifications: BusinessNotification[]
    nextCursor: string | null
    unreadCount: number
}

/** GET `/notifications`：读取当前账号最近的统一业务通知。 */
export function getNotifications(cursor: string | null = null) {
    return request.get<ApiResponse<BusinessNotificationPage>>('/notifications', {
        params: cursor ? { cursor } : undefined,
    })
}

/** PATCH `/notifications/:id/read`：标记当前账号自己的通知为已读。 */
export function markNotificationRead(notificationId: string) {
    return request.patch<
        ApiResponse<{ notification: BusinessNotification; unreadCount: number }>
    >(
        `/notifications/${notificationId}/read`,
    )
}

/** PATCH `/notifications/read`：标记当前账号全部未读通知。 */
export function markAllNotificationsRead() {
    return request.patch<ApiResponse<{ updatedCount: number; unreadCount: number }>>(
        '/notifications/read',
    )
}
