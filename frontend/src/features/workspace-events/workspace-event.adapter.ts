import { createWorkspaceEventToken } from '@/api/workspace'
import {
    createWorkspaceEventStreamClient,
    type WorkspaceCompensationReason,
    type WorkspaceEvent,
} from './workspace-event-stream'

const workspaceEventUiConstraints = {
    reconnectDelayMs: 2_000,
} as const

function streamUrl() {
    const apiBase = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/u, '')
    return `${apiBase}/workspace/events`
}

/** 装配浏览器流式 fetch；Supabase access token 仍只存在于 HttpOnly Cookie。 */
export function createBrowserWorkspaceEventStream(options: {
    onEvent: (event: WorkspaceEvent) => void
    onCompensate: (reason: WorkspaceCompensationReason) => void
}) {
    return createWorkspaceEventStreamClient({
        streamUrl: streamUrl(),
        getToken: createWorkspaceEventToken,
        fetchStream: (...arguments_) => fetch(...arguments_),
        onEvent: options.onEvent,
        onCompensate: options.onCompensate,
        reconnectDelayMs: workspaceEventUiConstraints.reconnectDelayMs,
        page: document,
    })
}
