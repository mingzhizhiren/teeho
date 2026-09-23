import type { BusinessNotification } from '@/api/notifications'
import { getFrontendRuntime } from '@/edition/runtime'

/** 解析分析通知，扩展通知由对应入口补充。 */
export function getBusinessNotificationPresentation(
    notification: BusinessNotification,
    translate: (key: string, params?: Record<string, unknown>) => string,
    locale: string,
): { title: string; body: string } {
    if (notification.type === 'analysis.completed')
        return {
            title: translate('notifications.completedTitle'),
            body: translate('notifications.completedBody'),
        }
    return (
        getFrontendRuntime().presentNotification(notification, translate, locale) ?? {
            title: translate('notifications.title'),
            body: translate('notifications.resultUnavailable'),
        }
    )
}
