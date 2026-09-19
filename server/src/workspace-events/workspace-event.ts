import { z } from 'zod'

export const workspaceEventSchema = z
    .object({
        id: z.string().regex(/^\d+$/u),
        type: z.enum([
            'task.changed',
            'result.available',
            'notification.created',
            'points.changed',
            'video.changed',
            'conversation.changed',
        ]),
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
type WorkspaceEventListener = (event: WorkspaceEvent) => void

export class WorkspaceEventConnectionLimitError extends Error {
    constructor() {
        super('工作台实时连接数已达上限')
        this.name = 'WorkspaceEventConnectionLimitError'
    }
}

interface WorkspaceEventHubLimits {
    maximumConnections: number
    maximumPerUser: number
}

/** 仅负责当前实例内按已验证 userId 扇出；事件来源仍是 PostgreSQL NOTIFY。 */
export class WorkspaceEventHub {
    private readonly listeners = new Map<string, Set<WorkspaceEventListener>>()
    private totalConnections = 0

    constructor(private readonly limits: WorkspaceEventHubLimits) {}

    get connectionCount() {
        return this.totalConnections
    }

    subscribe(userId: string, listener: WorkspaceEventListener) {
        const userListeners = this.listeners.get(userId) ?? new Set()
        if (
            this.totalConnections >= this.limits.maximumConnections ||
            userListeners.size >= this.limits.maximumPerUser
        ) {
            throw new WorkspaceEventConnectionLimitError()
        }
        userListeners.add(listener)
        this.listeners.set(userId, userListeners)
        this.totalConnections += 1
        let subscribed = true
        return () => {
            if (!subscribed) {
                return
            }
            subscribed = false
            userListeners.delete(listener)
            this.totalConnections -= 1
            if (userListeners.size === 0) {
                this.listeners.delete(userId)
            }
        }
    }

    publish(event: WorkspaceEvent) {
        for (const listener of this.listeners.get(event.userId) ?? []) {
            try {
                listener(event)
            } catch {
                // 单个慢或已关闭连接不能阻断同账号的其他标签页。
            }
        }
    }
}
