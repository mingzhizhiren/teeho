import { z } from 'zod'
import { useRouter } from 'vue-router'

import {
    getNotifications,
    markAllNotificationsRead,
    markNotificationRead,
} from '@/api/notifications'
import { useUserStorage } from '@/composables/useUserStorage'
import { getFrontendRuntime } from '@/edition/runtime'
import {
    buildBusinessNotificationRoute,
    createBrowserNotificationAdapter,
} from './browserNotifications'
import { upgradeBusinessNotificationPreference } from './businessNotificationPreference'
import {
    businessNotificationUiConstraints,
    type BusinessNotificationFlowAdapter,
} from './useBusinessNotifications'

const storedPreferenceSchema = z.object({
    browserEnabled: z.boolean(),
    deliveredIds: z.array(z.string().uuid()).max(businessNotificationUiConstraints.deliveredHistoryLimit),
    popupShownIds: z
        .array(z.string().uuid())
        .max(businessNotificationUiConstraints.deliveredHistoryLimit)
        .default([]),
})
const legacyStoredPreferenceSchema = z.object({
    browserEnabled: z.boolean(),
    deliveredIds: z
        .array(z.string().uuid())
        .max(businessNotificationUiConstraints.deliveredHistoryLimit),
})
const storageKey = 'business-notifications'
const legacyStorageKey = 'completion-notifications'

/** 装配统一业务通知所需的 HTTP、账号存储、路由和浏览器能力。 */
export function useBusinessNotificationFlowAdapter(): BusinessNotificationFlowAdapter {
    const router = useRouter()
    const userStorage = useUserStorage()
    const access = getFrontendRuntime().useAnalysisAccess()
    const browser = createBrowserNotificationAdapter()

    return {
        async listNotifications(cursor) {
            const response = await getNotifications(cursor)
            return response.data.data
        },
        async markRead(notificationId) {
            const response = await markNotificationRead(notificationId)
            return response.data.data
        },
        async markAllRead() {
            const response = await markAllNotificationsRead()
            return response.data.data
        },
        async loadPreference() {
            const current = await userStorage.getValue(storageKey, storedPreferenceSchema)
            if (current) {
                return current
            }
            const legacy = await userStorage.getValue(
                legacyStorageKey,
                legacyStoredPreferenceSchema,
            )
            const upgraded = upgradeBusinessNotificationPreference(
                current,
                legacy,
                browser.permission,
            )
            if (legacy && upgraded) {
                await userStorage.setValue(storageKey, upgraded)
                await userStorage.removeValue(legacyStorageKey)
            }
            return upgraded
        },
        savePreference: (preference) => userStorage.setValue(storageKey, preference),
        browser,
        async refreshAccountState() {
            await access.refresh()
        },
        async openTarget(target) {
            const route = buildBusinessNotificationRoute(target)
            if (route) await router.push(route)
        },
        nowIso: () => new Date().toISOString(),
    }
}
