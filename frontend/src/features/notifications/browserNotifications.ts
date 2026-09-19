import { getFrontendRuntime } from '@/edition/runtime'
import type { BusinessNotification } from '@/api/notifications'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export interface CompletionResultTarget {
    taskId: string
}

export type BusinessNotificationTarget =
    | { kind: 'analysis'; taskId: string }
    | { kind: 'extension'; route: { name: string; query: Record<string, string> } }
    | { kind: 'none' }

export interface BrowserNotificationHandle {
    onclick: ((event: Event) => void) | null
    close: () => void
}

export interface BrowserNotificationAdapter {
    supported: boolean
    permission: NotificationPermission
    requestPermission: () => Promise<NotificationPermission>
    isWorkspaceVisible: () => boolean
    show: (title: string, options: NotificationOptions) => BrowserNotificationHandle
    focusWindow: () => void
}

export function parseCompletionResultTarget(taskId: unknown): CompletionResultTarget | null {
    if (typeof taskId !== 'string' || !uuidPattern.test(taskId)) {
        return null
    }
    return { taskId }
}

export function buildCompletionResultRoute(target: CompletionResultTarget) {
    return {
        name: 'workspace' as const,
        query: { task: target.taskId },
    }
}

/** 根据受控类型提取固定站内目标，拒绝任意 URL 或非法业务标识。 */
export function parseBusinessNotificationTarget(
    notification: BusinessNotification,
): BusinessNotificationTarget | null {
    if (notification.type === 'analysis.completed') {
        const target = parseCompletionResultTarget(notification.payload.taskId)
        return target ? { kind: 'analysis', taskId: target.taskId } : null
    }
    const route = getFrontendRuntime().notificationRoute(notification)
    if (route === 'none') return { kind: 'none' }
    return route ? { kind: 'extension', route } : null
}

/** 构造命名路由，通知载荷无法提供 origin、path 或 redirect。 */
export function buildBusinessNotificationRoute(target: BusinessNotificationTarget) {
    if (target.kind === 'none') return null
    return target.kind === 'analysis'
        ? buildCompletionResultRoute({ taskId: target.taskId })
        : target.route
}

export function createBrowserNotificationAdapter(): BrowserNotificationAdapter {
    const supported = typeof window !== 'undefined' && typeof window.Notification !== 'undefined'
    return {
        supported,
        get permission() {
            return supported ? window.Notification.permission : 'denied'
        },
        requestPermission: () =>
            supported ? window.Notification.requestPermission() : Promise.resolve('denied'),
        isWorkspaceVisible: () =>
            typeof document !== 'undefined' && document.visibilityState === 'visible',
        show: (title, options) => new window.Notification(title, options),
        focusWindow: () => window.focus(),
    }
}

export async function requestBrowserNotificationPermission(adapter: BrowserNotificationAdapter) {
    if (!adapter.supported) {
        return 'unsupported' as const
    }
    if (adapter.permission === 'granted' || adapter.permission === 'denied') {
        return adapter.permission
    }
    return adapter.requestPermission()
}

export type BrowserDeliveryResult =
    | 'shown'
    | 'duplicate'
    | 'unsupported'
    | 'permission_missing'
    | 'workspace_visible'
    | 'invalid_target'

/** 同一个浏览器开关投递全部受控业务通知，并只绑定固定站内目标。 */
export function deliverBrowserBusinessNotification(
    adapter: BrowserNotificationAdapter,
    notification: BusinessNotification,
    deliveredIds: Set<string>,
    content: { title: string; body: string },
    openTarget: (target: BusinessNotificationTarget) => void,
): BrowserDeliveryResult {
    if (deliveredIds.has(notification.id)) {
        return 'duplicate'
    }
    const target = parseBusinessNotificationTarget(notification)
    if (!target) {
        return 'invalid_target'
    }
    if (!adapter.supported) {
        return 'unsupported'
    }
    if (adapter.permission !== 'granted') {
        return 'permission_missing'
    }
    if (adapter.isWorkspaceVisible()) {
        return 'workspace_visible'
    }

    const browserNotification = adapter.show(content.title, {
        body: content.body,
        tag: `teeho-business-notification-${notification.id}`,
    })
    browserNotification.onclick = () => {
        adapter.focusWindow()
        openTarget(target)
        browserNotification.close()
    }
    deliveredIds.add(notification.id)
    return 'shown'
}
