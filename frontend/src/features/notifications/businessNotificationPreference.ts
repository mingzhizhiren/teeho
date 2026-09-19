export interface StoredBusinessNotificationPreference {
    browserEnabled: boolean
    deliveredIds: string[]
    popupShownIds: string[]
}

export interface LegacyStoredBusinessNotificationPreference {
    browserEnabled: boolean
    deliveredIds: string[]
}

/** 统一偏好优先；旧开关仅在权限仍有效时升级，旧投递 ID 永不复制。 */
export function upgradeBusinessNotificationPreference(
    current: StoredBusinessNotificationPreference | null,
    legacy: LegacyStoredBusinessNotificationPreference | null,
    permission: NotificationPermission,
): StoredBusinessNotificationPreference | null {
    if (current) {
        return current
    }
    if (!legacy) {
        return null
    }
    return {
        browserEnabled: legacy.browserEnabled && permission === 'granted',
        deliveredIds: [],
        popupShownIds: [],
    }
}
