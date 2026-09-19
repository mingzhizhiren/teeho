<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import InlineFeedback from '@/components/feedback/InlineFeedback.vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import { formatDateTime } from '@/utils/format'
import type { BusinessNotification } from '@/api/notifications'
import { useWorkspaceEventsStore } from '@/stores/workspaceEvents'
import { useBusinessNotificationFlowAdapter } from './businessNotifications.adapter'
import { getBusinessNotificationPresentation } from './businessNotificationPresentation'
import {
    useBusinessNotifications,
    type BusinessNotificationMessage,
} from './useBusinessNotifications'

const notificationTextKeys: Record<BusinessNotificationMessage, string> = {
    loadFailed: 'notifications.loadFailed',
    markAllReadFailed: 'notifications.markAllReadFailed',
    markReadFailed: 'notifications.markReadFailed',
    loadMoreFailed: 'notifications.loadMoreFailed',
    preferenceLoadFailed: 'notifications.preferenceLoadFailed',
    preferenceSaveFailed: 'notifications.preferenceSaveFailed',
    browserTitle: 'notifications.browserTitle',
    browserBody: 'notifications.browserBody',
}
const { locale, t } = useI18n()
const notificationCenter = ref<HTMLElement | null>(null)
const workspaceEvents = useWorkspaceEventsStore()
const presentation = (notification: BusinessNotification) =>
    getBusinessNotificationPresentation(
        notification,
        (key, params) => t(key, params ?? {}),
        locale.value,
    )
const notificationFlow = useBusinessNotifications(
    useBusinessNotificationFlowAdapter(),
    (message) => t(notificationTextKeys[message]),
    presentation,
)
const {
    notifications,
    panelOpen,
    browserEnabled,
    permissionState,
    notificationPopup,
    error: notificationError,
    markingAllRead,
    loadingMore,
    browserSupported,
    unreadCount,
    nextCursor,
    dismissError: dismissNotificationError,
    openNotification,
    markAllRead,
    loadMore,
    toggleBrowserNotifications,
} = notificationFlow
const browserButtonLabel = computed(() => {
    if (!browserSupported) {
        return t('notifications.browserUnavailable')
    }
    if (browserEnabled.value && permissionState.value === 'granted') {
        return t('notifications.browserEnabled')
    }
    return t('notifications.enableBrowser')
})

/** 按当前语言格式化日期时间 */
function formatDate(value: string) {
    return formatDateTime(value, locale.value)
}

/** 点击通知面板外部时关闭面板 */
function closePanelOnOutsidePointer(event: PointerEvent) {
    const target = event.target
    if (panelOpen.value && target instanceof Node && !notificationCenter.value?.contains(target)) {
        panelOpen.value = false
    }
}

onMounted(async () => {
    document.addEventListener('pointerdown', closePanelOnOutsidePointer)
    await notificationFlow.initialize()
    notificationFlow.start()
})

watch(
    () => workspaceEvents.notificationRevision,
    () => {
        void notificationFlow.refresh()
    },
)

onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', closePanelOnOutsidePointer)
    notificationFlow.stop()
})
</script>

<template>
    <div ref="notificationCenter" class="relative">
        <button
            class="relative flex h-10 w-10 items-center justify-center rounded-xl border border-line text-muted transition hover:border-brand/40 hover:bg-brand/5 hover:text-ink"
            type="button"
            :aria-label="t('notifications.centerLabel')"
            :aria-expanded="panelOpen"
            @click="panelOpen = !panelOpen"
        >
            <AppIcon name="bell" />
            <span
                v-if="unreadCount"
                class="absolute -right-1 -top-1 min-w-5 rounded-full bg-brand px-1 text-center text-[10px] font-bold leading-5 text-on-brand"
            >
                {{ unreadCount > 9 ? '9+' : unreadCount }}
            </span>
        </button>

        <div
            v-if="panelOpen"
            class="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-surface shadow-xl"
        >
            <div class="border-b border-line p-4">
                <div class="flex items-start justify-between gap-3">
                    <div>
                        <h2 class="text-sm font-semibold text-ink">
                            {{ t('notifications.title') }}
                        </h2>
                        <p class="mt-1 text-xs leading-5 text-muted">
                            {{ t('notifications.inAppAlwaysOn') }}
                        </p>
                    </div>
                    <div class="flex shrink-0 flex-col items-stretch gap-2">
                        <button
                            class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-muted transition hover:border-brand/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                            type="button"
                            :disabled="!browserSupported"
                            @click="toggleBrowserNotifications"
                        >
                            {{ browserButtonLabel }}
                        </button>
                        <button
                            class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-muted transition hover:border-brand/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                            type="button"
                            :disabled="unreadCount === 0 || markingAllRead"
                            @click="markAllRead"
                        >
                            {{
                                markingAllRead
                                    ? t('notifications.markingAllRead')
                                    : t('notifications.markAllRead')
                            }}
                        </button>
                    </div>
                </div>
                <p
                    v-if="permissionState === 'denied' || !browserSupported"
                    class="mt-2 text-[11px] leading-4 text-muted"
                >
                    {{
                        browserSupported
                            ? t('notifications.permissionDenied')
                            : t('notifications.unsupported')
                    }}
                </p>
            </div>

            <div class="max-h-80 overflow-y-auto p-2">
                <InlineFeedback
                    v-if="notificationError"
                    class="mx-2 mb-2"
                    compact
                    :feedback="{
                        key: 'notifications.center.sync',
                        scope: 'module',
                        tone: 'error',
                        message: notificationError,
                    }"
                    :dismiss-policy="notifications.length ? 'after-interaction' : 'persistent'"
                    @dismiss="dismissNotificationError"
                />
                <button
                    v-for="notification in notifications"
                    :key="notification.id"
                    data-testid="business-notification-item"
                    class="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-surface-muted"
                    type="button"
                    @click="openNotification(notification)"
                >
                    <span
                        class="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                        :class="notification.readAt ? 'bg-line' : 'bg-brand'"
                    ></span>
                    <span class="min-w-0">
                        <span class="block text-sm font-semibold text-ink">
                            {{ presentation(notification).title }}
                        </span>
                        <span class="mt-1 block text-xs leading-5 text-muted">
                            {{ presentation(notification).body }}
                        </span>
                        <span class="mt-1 block text-[11px] text-muted">
                            {{ formatDate(notification.createdAt) }}
                        </span>
                    </span>
                </button>
                <p
                    v-if="!notifications.length"
                    class="px-4 py-8 text-center text-xs leading-5 text-muted"
                >
                    {{ t('notifications.empty') }}
                </p>
                <button
                    v-if="nextCursor"
                    class="mx-2 mb-2 w-[calc(100%-1rem)] rounded-xl border border-line px-3 py-2 text-xs font-semibold text-muted transition hover:border-brand/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                    type="button"
                    :disabled="loadingMore"
                    @click="loadMore"
                >
                    {{ loadingMore ? t('notifications.loadingMore') : t('notifications.loadMore') }}
                </button>
            </div>
        </div>

        <button
            v-if="notificationPopup"
            class="fixed right-4 top-20 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-brand/20 bg-surface p-4 text-left shadow-xl"
            type="button"
            @click="openNotification(notificationPopup)"
        >
            <span class="flex items-start gap-3">
                <span
                    class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand"
                    aria-hidden="true"
                >
                    <AppIcon name="check" />
                </span>
                <span>
                    <span class="block text-sm font-semibold text-ink">
                        {{ presentation(notificationPopup).title }}
                    </span>
                    <span class="mt-1 block text-xs leading-5 text-muted">
                        {{ presentation(notificationPopup).body }}
                    </span>
                </span>
            </span>
        </button>
    </div>
</template>
