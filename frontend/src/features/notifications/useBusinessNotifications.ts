import { computed, ref } from 'vue'

import type { BusinessNotification, BusinessNotificationPage } from '@/api/notifications'
import { LatestRequestGate } from '@/utils/latestRequestGate'
import {
    deliverBrowserBusinessNotification,
    parseBusinessNotificationTarget,
    requestBrowserNotificationPermission,
    type BrowserNotificationAdapter,
    type BusinessNotificationTarget,
} from './browserNotifications'

/** 业务通知展示、轮询与投递历史的前端限制。 */
export const businessNotificationUiConstraints = {
    deliveredHistoryLimit: 200,
    notificationPopupDurationMs: 7_000,
} as const

/** 当前账号保存的浏览器通知偏好；issue08 将升级旧存储键。 */
export interface BusinessNotificationPreference {
    browserEnabled: boolean
    deliveredIds: string[]
    popupShownIds: string[]
}

/** 业务通知流程依赖的请求、存储、浏览器、积分与导航能力。 */
export interface BusinessNotificationFlowAdapter {
    listNotifications: (cursor: string | null) => Promise<BusinessNotificationPage>
    markRead: (notificationId: string) => Promise<{
        notification: BusinessNotification
        unreadCount: number
    }>
    markAllRead: () => Promise<{ updatedCount: number; unreadCount: number }>
    loadPreference: () => Promise<BusinessNotificationPreference | null>
    savePreference: (preference: BusinessNotificationPreference) => Promise<unknown>
    browser: BrowserNotificationAdapter
    refreshAccountState: () => Promise<unknown>
    openTarget: (target: BusinessNotificationTarget) => Promise<unknown>
    nowIso: () => string
}

/** 业务通知流程向界面请求的受控文案键。 */
export type BusinessNotificationMessage =
    | 'loadFailed'
    | 'markAllReadFailed'
    | 'markReadFailed'
    | 'loadMoreFailed'
    | 'preferenceLoadFailed'
    | 'preferenceSaveFailed'
    | 'browserTitle'
    | 'browserBody'

/** 管理统一业务通知同步、已读、偏好、浏览器投递与通知弹窗生命周期。 */
export function useBusinessNotifications(
    adapter: BusinessNotificationFlowAdapter,
    text: (message: BusinessNotificationMessage) => string,
    present: (notification: BusinessNotification) => { title: string; body: string } = () => ({
        title: text('browserTitle'),
        body: text('browserBody'),
    }),
) {
    const notifications = ref<BusinessNotification[]>([])
    const panelOpen = ref(false)
    const browserEnabled = ref(false)
    const permissionState = ref<NotificationPermission>(adapter.browser.permission)
    const notificationPopup = ref<BusinessNotification | null>(null)
    const requestError = ref('')
    const preferenceError = ref('')
    const error = computed(() => requestError.value || preferenceError.value)
    const markingAllRead = ref(false)
    const loadingMore = ref(false)
    const unreadCount = ref(0)
    const nextCursor = ref<string | null>(null)
    const deliveredIds = new Set<string>()
    const popupShownIds = new Set<string>()
    const refreshGate = new LatestRequestGate()
    let notificationPopupTimer: ReturnType<typeof setTimeout> | undefined

    /** 加密保存当前账号的浏览器通知偏好。 */
    async function savePreference(clearErrorOnSuccess = true) {
        try {
            await adapter.savePreference({
                browserEnabled: browserEnabled.value,
                deliveredIds: [...deliveredIds].slice(
                    -businessNotificationUiConstraints.deliveredHistoryLimit,
                ),
                popupShownIds: [...popupShownIds].slice(
                    -businessNotificationUiConstraints.deliveredHistoryLimit,
                ),
            })
            if (clearErrorOnSuccess) {
                preferenceError.value = ''
            }
        } catch {
            preferenceError.value = text('preferenceSaveFailed')
        }
    }

    /** 读取当前账号的浏览器通知偏好。 */
    async function loadPreference() {
        try {
            const stored = await adapter.loadPreference()
            browserEnabled.value = stored?.browserEnabled ?? false
            for (const notificationId of stored?.deliveredIds ?? []) {
                deliveredIds.add(notificationId)
            }
            for (const notificationId of stored?.popupShownIds ?? []) {
                popupShownIds.add(notificationId)
            }
            preferenceError.value = ''
        } catch {
            browserEnabled.value = false
            preferenceError.value = text('preferenceLoadFailed')
        }

        permissionState.value = adapter.browser.permission
        if (browserEnabled.value && permissionState.value !== 'granted') {
            browserEnabled.value = false
            await savePreference()
        }
    }

    /** 展示新到达的受控业务通知。 */
    function showNotificationPopup(notification: BusinessNotification) {
        notificationPopup.value = notification
        if (notificationPopupTimer) {
            clearTimeout(notificationPopupTimer)
        }
        notificationPopupTimer = setTimeout(() => {
            notificationPopup.value = null
        }, businessNotificationUiConstraints.notificationPopupDurationMs)
    }

    /** 标记已读后打开由通知类型决定的固定站内目标。 */
    async function openNotification(notification: BusinessNotification) {
        const target = parseBusinessNotificationTarget(notification)
        if (!target) {
            return
        }

        panelOpen.value = false
        notificationPopup.value = null
        refreshGate.invalidate()
        try {
            const result = await adapter.markRead(notification.id)
            refreshGate.invalidate()
            notifications.value = notifications.value.map((current) =>
                current.id === notification.id ? result.notification : current,
            )
            unreadCount.value = result.unreadCount
            requestError.value = ''
        } catch {
            requestError.value = text('markReadFailed')
        } finally {
            refreshGate.invalidate()
            await adapter.openTarget(target)
        }
    }

    /** 标记当前账号全部通知已读并更新本地列表。 */
    async function markAllReadNotifications() {
        if (unreadCount.value === 0 || markingAllRead.value) {
            return
        }

        markingAllRead.value = true
        refreshGate.invalidate()
        try {
            const result = await adapter.markAllRead()
            refreshGate.invalidate()
            const readAt = adapter.nowIso()
            notifications.value = notifications.value.map((notification) =>
                notification.readAt === null ? { ...notification, readAt } : notification,
            )
            unreadCount.value = result.unreadCount
            requestError.value = ''
        } catch {
            requestError.value = text('markAllReadFailed')
        } finally {
            refreshGate.invalidate()
            markingAllRead.value = false
        }
    }

    /** 切换浏览器业务通知权限和偏好。 */
    async function toggleBrowserNotifications() {
        if (!adapter.browser.supported) {
            return
        }
        if (browserEnabled.value) {
            browserEnabled.value = false
            await savePreference()
            return
        }

        const permission = await requestBrowserNotificationPermission(adapter.browser)
        permissionState.value = permission === 'unsupported' ? 'denied' : permission
        browserEnabled.value = permission === 'granted'
        await savePreference()
    }

    /** 拉取权威通知列表并处理新到达的分析完成项。 */
    async function refreshNotifications() {
        await refreshGate.run(async (isCurrent) => {
            try {
                const previousIds = new Set(
                    notifications.value.map((notification) => notification.id),
                )
                const incoming = await adapter.listNotifications(null)
                if (!isCurrent()) {
                    return
                }
                notifications.value = incoming.notifications
                nextCursor.value = incoming.nextCursor
                unreadCount.value = incoming.unreadCount
                requestError.value = ''
                permissionState.value = adapter.browser.permission
                if (browserEnabled.value && permissionState.value !== 'granted') {
                    browserEnabled.value = false
                    await savePreference()
                    if (!isCurrent()) {
                        return
                    }
                }

                const newUnread = incoming.notifications.filter(
                    (notification) =>
                        notification.readAt === null && !previousIds.has(notification.id),
                )
                const popupCandidate = newUnread[0]
                if (popupCandidate && !popupShownIds.has(popupCandidate.id)) {
                    popupShownIds.add(popupCandidate.id)
                    showNotificationPopup(popupCandidate)
                    await savePreference(false)
                    if (!isCurrent()) {
                        return
                    }
                    if (popupCandidate.type === 'analysis.completed') {
                        void adapter.refreshAccountState()
                    }
                }

                if (browserEnabled.value && isCurrent()) {
                    let preferenceChanged = false
                    for (const notification of incoming.notifications) {
                        if (notification.readAt !== null) {
                            continue
                        }
                        const result = deliverBrowserBusinessNotification(
                            adapter.browser,
                            notification,
                            deliveredIds,
                            present(notification),
                            () => void openNotification(notification),
                        )
                        preferenceChanged ||= result === 'shown'
                    }
                    if (preferenceChanged) {
                        await savePreference()
                    }
                }
            } catch {
                if (isCurrent()) {
                    requestError.value = text('loadFailed')
                }
            }
        })
    }

    /** 仅在用户明确操作时使用当前游标追加更旧通知。 */
    async function loadMoreNotifications() {
        const cursor = nextCursor.value
        if (!cursor || loadingMore.value) {
            return
        }
        loadingMore.value = true
        try {
            const incoming = await adapter.listNotifications(cursor)
            const existingIds = new Set(notifications.value.map((notification) => notification.id))
            notifications.value = [
                ...notifications.value,
                ...incoming.notifications.filter(
                    (notification) => !existingIds.has(notification.id),
                ),
            ]
            nextCursor.value = incoming.nextCursor
            unreadCount.value = incoming.unreadCount
            requestError.value = ''
        } catch {
            requestError.value = text('loadMoreFailed')
        } finally {
            loadingMore.value = false
        }
    }

    /** 只关闭当前通知面板提示，不改变通知或偏好权威状态。 */
    function dismissError() {
        requestError.value = ''
        preferenceError.value = ''
    }

    return {
        notifications,
        panelOpen,
        browserEnabled,
        permissionState,
        notificationPopup,
        error,
        markingAllRead,
        loadingMore,
        browserSupported: adapter.browser.supported,
        unreadCount,
        nextCursor,
        dismissError,
        openNotification,
        markAllRead: markAllReadNotifications,
        toggleBrowserNotifications,
        refresh: refreshNotifications,
        loadMore: loadMoreNotifications,
        async initialize() {
            await loadPreference()
            await refreshNotifications()
        },
        start() {
            return undefined
        },
        stop() {
            refreshGate.invalidate()
            if (notificationPopupTimer) {
                clearTimeout(notificationPopupTimer)
                notificationPopupTimer = undefined
            }
        },
    }
}
