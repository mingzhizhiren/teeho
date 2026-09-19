import postgres from 'postgres'

import { logger } from '../utils/logger'
import { workspaceEventSchema, type WorkspaceEventHub } from './workspace-event'
import { workspaceEventConstraints } from './workspace-event.constants'

interface WorkspaceEventListenHandle {
    unlisten(): Promise<void>
}

interface WorkspaceEventListenClient {
    listen(
        channel: string,
        onNotification: (payload: string) => void,
    ): Promise<WorkspaceEventListenHandle>
    end(options?: { timeout?: number }): Promise<void>
}

interface WorkspaceEventListenerOptions {
    databaseUrl: string
    hub: WorkspaceEventHub
    createClient?: (databaseUrl: string) => WorkspaceEventListenClient
    log?: Pick<typeof logger, 'warn'>
}

function createPostgresListenClient(databaseUrl: string): WorkspaceEventListenClient {
    return postgres(databaseUrl, {
        max: 1,
        idle_timeout: 0,
        prepare: false,
    })
}

/** 使用独立 session/直连连接 LISTEN；每个 API 实例都接收同一提交后通知。 */
export class PostgresWorkspaceEventListener {
    private readonly client: WorkspaceEventListenClient
    private readonly hub: WorkspaceEventHub
    private readonly log: Pick<typeof logger, 'warn'>
    private handle: WorkspaceEventListenHandle | null = null

    constructor(options: WorkspaceEventListenerOptions) {
        if (!options.databaseUrl) {
            throw new Error('DATABASE_DIRECT_URL 未配置')
        }
        this.client = (options.createClient ?? createPostgresListenClient)(options.databaseUrl)
        this.hub = options.hub
        this.log = options.log ?? logger
    }

    async start() {
        if (this.handle) {
            return
        }
        this.handle = await this.client.listen(workspaceEventConstraints.channel, (payload) => {
            try {
                const parsed = workspaceEventSchema.safeParse(JSON.parse(payload))
                if (!parsed.success) {
                    this.log.warn(
                        {
                            event: 'workspace_event_invalid',
                            errorCode: 'workspace_event_invalid',
                        },
                        '忽略无效工作台事件',
                    )
                    return
                }
                this.hub.publish(parsed.data)
            } catch {
                this.log.warn(
                    {
                        event: 'workspace_event_invalid_json',
                        errorCode: 'workspace_event_invalid_json',
                    },
                    '忽略无效工作台事件',
                )
            }
        })
    }

    async stop() {
        const handle = this.handle
        this.handle = null
        await handle?.unlisten()
        await this.client.end({ timeout: 5 })
    }
}
