import { z } from 'zod'
import { getFrontendRuntime } from '@/edition/runtime'

const eventIdPrefixLength = 'id:'.length
const eventDataPrefixLength = 'data:'.length
const eventBoundaryLength = '\n\n'.length

export const workspaceEventSchema = z
    .object({
        id: z.string().regex(/^\d+$/u),
        type: z
            .string()
            .refine((type) =>
                [
                    'task.changed',
                    'result.available',
                    'notification.created',
                    'video.changed',
                    'conversation.changed',
                    ...getFrontendRuntime().workspaceEventTypes,
                ].includes(type),
            ),
        userId: z.string().uuid(),
        resourceId: z.string().uuid(),
        status: z
            .enum([
                'researching',
                'queued',
                'processing',
                'retrying',
                'succeeded',
                'technical_failed',
                'insufficient_points',
                'abandoned',
                'cancelled',
                'awaiting_upload',
                'uploaded',
                'ready',
                'deterministic_failed',
                'expired',
                'deleting',
                'deleted',
                'cleanup_failed',
                'active',
                'finalized',
                'submitted',
                'cleared',
            ])
            .nullable(),
        version: z.number().int().positive().nullable(),
        occurredAt: z.string().datetime({ offset: true }),
    })
    .strict()

export type WorkspaceEvent = z.infer<typeof workspaceEventSchema>
export type WorkspaceCompensationReason = 'connected' | 'gap' | 'visible'

/** 丢弃重复/乱序事件，并用每用户连续 ID 检测缺口。 */
export class WorkspaceEventCursor {
    private lastId = 0

    constructor(private readonly compensate: (reason: WorkspaceCompensationReason) => void) {}

    get lastEventId() {
        return this.lastId === 0 ? null : String(this.lastId)
    }

    accept(eventId: string) {
        const numericId = Number(eventId)
        if (!Number.isSafeInteger(numericId) || numericId <= this.lastId) {
            return false
        }
        if (this.lastId > 0 && numericId > this.lastId + 1) {
            this.compensate('gap')
        }
        this.lastId = numericId
        return true
    }
}

interface ConnectWorkspaceEventStreamOptions {
    streamUrl: string
    getToken: () => Promise<string>
    fetchStream: typeof fetch
    cursor: WorkspaceEventCursor
    signal: AbortSignal
    onEvent: (event: WorkspaceEvent) => void
    onConnected: () => void
}

function parseEventBlock(block: string) {
    let headerId: string | null = null
    const data: string[] = []
    for (const line of block.split('\n')) {
        if (line.startsWith('id:')) {
            headerId = line.slice(eventIdPrefixLength).trim()
        } else if (line.startsWith('data:')) {
            data.push(line.slice(eventDataPrefixLength).trimStart())
        }
    }
    if (!headerId || data.length === 0) {
        return null
    }
    try {
        const parsed = workspaceEventSchema.safeParse(JSON.parse(data.join('\n')))
        if (!parsed.success || parsed.data.id !== headerId) {
            return null
        }
        return parsed.data
    } catch {
        return null
    }
}

/** 建立一次带 Authorization 的流式 fetch，直到服务器关闭或调用方 Abort。 */
export async function connectWorkspaceEventStreamOnce(options: ConnectWorkspaceEventStreamOptions) {
    const token = await options.getToken()
    const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
    }
    if (options.cursor.lastEventId) {
        headers['Last-Event-ID'] = options.cursor.lastEventId
    }
    const response = await options.fetchStream(options.streamUrl, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers,
        signal: options.signal,
    })
    if (!response.ok || !response.body) {
        throw new Error('工作台连接暂时不可用')
    }
    options.onConnected()
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
        const { done, value } = await reader.read()
        if (done) {
            break
        }
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/gu, '\n')
        let boundary = buffer.indexOf('\n\n')
        while (boundary >= 0) {
            const block = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + eventBoundaryLength)
            const event = parseEventBlock(block)
            if (event && options.cursor.accept(event.id)) {
                options.onEvent(event)
            }
            boundary = buffer.indexOf('\n\n')
        }
    }
}

interface WorkspaceEventStreamClientOptions extends Omit<
    ConnectWorkspaceEventStreamOptions,
    'cursor' | 'signal' | 'onConnected'
> {
    onCompensate: (reason: WorkspaceCompensationReason) => void
    reconnectDelayMs: number
    page?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>
}

/** 管理断线重连、页面可见补偿和离开页面时的 Abort。 */
export function createWorkspaceEventStreamClient(options: WorkspaceEventStreamClientOptions) {
    const cursor = new WorkspaceEventCursor(options.onCompensate)
    let stopped = true
    let controller: AbortController | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const connect = async () => {
        if (stopped || controller) {
            return
        }
        controller = new AbortController()
        try {
            await connectWorkspaceEventStreamOnce({
                ...options,
                cursor,
                signal: controller.signal,
                onConnected: () => options.onCompensate('connected'),
            })
        } catch {
            // HTTP 权威读取仍可用；短延迟后重新取得新流凭据。
        } finally {
            controller = null
            if (!stopped) {
                reconnectTimer = setTimeout(() => {
                    reconnectTimer = null
                    void connect()
                }, options.reconnectDelayMs)
            }
        }
    }

    const onVisibilityChange = () => {
        if (options.page?.visibilityState === 'visible') {
            options.onCompensate('visible')
        }
    }

    return {
        start() {
            if (!stopped) {
                return
            }
            stopped = false
            options.page?.addEventListener('visibilitychange', onVisibilityChange)
            void connect()
        },
        stop() {
            stopped = true
            options.page?.removeEventListener('visibilitychange', onVisibilityChange)
            controller?.abort()
            controller = null
            if (reconnectTimer) {
                clearTimeout(reconnectTimer)
                reconnectTimer = null
            }
        },
    }
}
