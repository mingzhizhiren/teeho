import { defineStore } from 'pinia'
import { ref } from 'vue'

import { useAuthStore } from './auth'
import type { WorkspaceEvent } from '@/features/workspace-events/workspace-event-stream'

/** 同一 SSE 连接向任务、通知和部署扩展发送轻量刷新提示。 */
export const useWorkspaceEventsStore = defineStore('workspace-events', () => {
    const auth = useAuthStore()
    const taskRevision = ref(0)
    const notificationRevision = ref(0)
    const extensionRevision = ref(0)
    const videoRevision = ref(0)
    const conversationRevision = ref(0)
    const ownerUserId = ref<string | null>(null)

    function reset(userId: string | null) {
        ownerUserId.value = userId
        taskRevision.value = 0
        notificationRevision.value = 0
        extensionRevision.value = 0
        videoRevision.value = 0
        conversationRevision.value = 0
    }

    function receive(event: WorkspaceEvent) {
        if (!ownerUserId.value || event.userId !== ownerUserId.value) {
            return
        }
        if (event.type === 'task.changed' || event.type === 'result.available') {
            taskRevision.value += 1
        } else if (event.type === 'notification.created') {
            notificationRevision.value += 1
        } else if (!['task.changed', 'result.available', 'notification.created', 'video.changed', 'conversation.changed'].includes(event.type)) {
            extensionRevision.value += 1
        } else if (event.type === 'video.changed') {
            videoRevision.value += 1
        } else if (event.type === 'conversation.changed') {
            conversationRevision.value += 1
        }
    }

    /** 重连、缺口或重新可见时一次校准三个 HTTP 权威来源。 */
    function compensate() {
        if (!ownerUserId.value || ownerUserId.value !== auth.user?.id) {
            return
        }
        taskRevision.value += 1
        notificationRevision.value += 1
        extensionRevision.value += 1
        videoRevision.value += 1
        conversationRevision.value += 1
    }

    return {
        taskRevision,
        notificationRevision,
        extensionRevision,
        videoRevision,
        conversationRevision,
        reset,
        receive,
        compensate,
    }
})
