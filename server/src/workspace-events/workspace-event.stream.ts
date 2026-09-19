import type { WorkspaceEvent, WorkspaceEventHub } from './workspace-event'
import { workspaceEventConstraints } from './workspace-event.constants'

const encoder = new TextEncoder()

function encodeEvent(event: WorkspaceEvent) {
    return encoder.encode(
        `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
    )
}

/** 创建具备心跳、Abort 清理与慢消费者淘汰的用户级 SSE 响应。 */
export function createWorkspaceEventResponse(
    hub: WorkspaceEventHub,
    userId: string,
    signal: AbortSignal,
) {
    let release: () => void = () => undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let closed = false

    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const close = () => {
                if (closed) {
                    return
                }
                closed = true
                if (heartbeat) {
                    clearInterval(heartbeat)
                    heartbeat = undefined
                }
                release()
                try {
                    controller.close()
                } catch {
                    // 客户端可能已取消底层流。
                }
            }
            if (signal.aborted) {
                close()
                return
            }
            release = hub.subscribe(userId, (event) => {
                if (closed) {
                    return
                }
                if (controller.desiredSize !== null && controller.desiredSize <= 0) {
                    close()
                    return
                }
                controller.enqueue(encodeEvent(event))
            })
            controller.enqueue(
                encoder.encode(
                    `retry: ${workspaceEventConstraints.clientReconnectDelayMs}\n: connected\n\n`,
                ),
            )
            heartbeat = setInterval(() => {
                if (controller.desiredSize !== null && controller.desiredSize <= 0) {
                    close()
                    return
                }
                controller.enqueue(encoder.encode(': heartbeat\n\n'))
            }, workspaceEventConstraints.heartbeatIntervalMs)
            signal.addEventListener('abort', close, { once: true })
        },
        cancel() {
            if (!closed) {
                closed = true
                if (heartbeat) {
                    clearInterval(heartbeat)
                }
                release()
            }
        },
    })

    return new Response(stream, {
        headers: {
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
            'content-type': 'text/event-stream; charset=utf-8',
            'x-accel-buffering': 'no',
        },
    })
}
