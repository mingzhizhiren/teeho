import { describe, expect, it, vi } from 'vitest'

import { runCodexAppServer, type CodexAppServerSocketFactory } from './analysis.codex-app-server'
import { AgentContractError, readAgentProviderExecutionMetadata } from './analysis.provider'

class FakeAppServerSocket extends EventTarget {
    readonly sent: Record<string, unknown>[] = []
    readyState: number = WebSocket.CONNECTING

    constructor(
        private readonly itemType = 'agentMessage',
        private readonly completeTurn = true,
        private readonly threadStartError: { code: number; message: string } | null = null,
        private readonly itemCompletedResult: Record<string, unknown> | null = { ok: true },
        private readonly turnCompletedResult: Record<string, unknown> | null = null,
        private readonly turnStatus: 'completed' | 'failed' = 'completed',
        private readonly turnError: { message: string } | null = null,
        private readonly totalTokens = 15,
        private readonly emitWebSearchStartedPlaceholder = false,
        private readonly cachedInputTokens = 7,
        private readonly additionalItemCompletedResults: Record<string, unknown>[] = [],
    ) {
        super()
        queueMicrotask(() => {
            this.readyState = WebSocket.OPEN
            this.dispatchEvent(new Event('open'))
        })
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        if (typeof data !== 'string') {
            throw new Error('Fake socket only accepts text messages')
        }
        const message = JSON.parse(data) as Record<string, unknown>
        this.sent.push(message)
        if (typeof message.id !== 'number') {
            return
        }
        switch (message.method) {
            case 'initialize':
                this.respond(message.id, {})
                break
            case 'thread/start':
                if (this.threadStartError) {
                    this.respondError(message.id, this.threadStartError)
                    break
                }
                this.respond(message.id, { thread: { id: 'remote-thread-1' } })
                break
            case 'turn/start':
                this.respond(message.id, {
                    turn: { id: 'remote-turn-1', status: 'inProgress', items: [] },
                })
                if (!this.completeTurn) {
                    break
                }
                queueMicrotask(() => {
                    if (this.itemType === 'webSearch' && this.emitWebSearchStartedPlaceholder) {
                        this.notify('item/started', {
                            threadId: 'remote-thread-1',
                            turnId: 'remote-turn-1',
                            item: {
                                type: 'webSearch',
                                id: 'web-search-1',
                                query: '',
                                action: null,
                                results: null,
                            },
                        })
                    }
                    const completedResults = this.itemCompletedResult
                        ? [this.itemCompletedResult, ...this.additionalItemCompletedResults]
                        : []
                    for (const completedResult of completedResults) {
                        const item =
                            this.itemType === 'webSearch'
                                ? { type: this.itemType, ...completedResult }
                                : {
                                      type: this.itemType,
                                      text: JSON.stringify(completedResult),
                                  }
                        this.notify('item/completed', {
                            threadId: 'remote-thread-1',
                            turnId: 'remote-turn-1',
                            item,
                        })
                    }
                    this.notify('thread/tokenUsage/updated', {
                        threadId: 'remote-thread-1',
                        turnId: 'remote-turn-1',
                        tokenUsage: {
                            total: {
                                inputTokens: Math.max(0, this.totalTokens - 3),
                                cachedInputTokens: this.cachedInputTokens,
                                cacheWriteInputTokens: 0,
                                outputTokens: 3,
                                reasoningOutputTokens: 2,
                                totalTokens: this.totalTokens,
                            },
                        },
                    })
                    this.notify('turn/completed', {
                        threadId: 'remote-thread-1',
                        turn: {
                            id: 'remote-turn-1',
                            status: this.turnStatus,
                            error: this.turnError,
                            items: this.turnCompletedResult
                                ? [
                                      {
                                          id: 'reasoning-1',
                                          type: 'reasoning',
                                          summary: ['not the final message'],
                                      },
                                      {
                                          id: 'agent-message-1',
                                          type: 'agentMessage',
                                          text: JSON.stringify(this.turnCompletedResult),
                                      },
                                  ]
                                : [],
                        },
                    })
                })
                break
            case 'turn/interrupt':
                this.respond(message.id, {})
                break
        }
    }

    close() {
        this.readyState = WebSocket.CLOSED
    }

    private respond(id: number, result: unknown) {
        queueMicrotask(() => {
            this.dispatchEvent(
                new MessageEvent('message', {
                    data: JSON.stringify({ id, result }),
                }),
            )
        })
    }

    private notify(method: string, params: unknown) {
        this.dispatchEvent(
            new MessageEvent('message', {
                data: JSON.stringify({ method, params }),
            }),
        )
    }

    private respondError(id: number, error: { code: number; message: string }) {
        queueMicrotask(() => {
            this.dispatchEvent(
                new MessageEvent('message', {
                    data: JSON.stringify({ id, error }),
                }),
            )
        })
    }
}

class NeverOpenSocket extends EventTarget {
    readyState: number = WebSocket.CONNECTING

    send() {
        throw new Error('Socket is not open')
    }

    close() {
        this.readyState = WebSocket.CLOSED
    }
}

function createRequest(signal = new AbortController().signal) {
    return {
        url: 'ws://127.0.0.1:14500',
        token: 'remote-test-token',
        model: 'codex-test-model',
        prompt: 'Return JSON',
        outputSchema: {
            type: 'object',
            properties: { ok: { type: 'boolean' } },
            required: ['ok'],
        },
        images: [
            {
                reference: '00000000-0000-4000-8000-000000000001',
                mediaType: 'image/png' as const,
                byteSize: 3,
                width: 1,
                height: 1,
                content: new Uint8Array([1, 2, 3]),
                availability: 'processed_private' as const,
            },
        ],
        signal,
    }
}

describe('Codex App Server transport', () => {
    it('联网资料请求只额外允许 webSearch 并启用 live 搜索配置', async () => {
        const socket = new FakeAppServerSocket(
            'webSearch',
            true,
            null,
            { query: '通勤防晒 近期 官方' },
            { ok: true },
        )

        await expect(
            runCodexAppServer(
                {
                    ...createRequest(),
                    images: [],
                    webSearch: true,
                },
                () => socket as unknown as WebSocket,
            ),
        ).resolves.toEqual({ ok: true })

        const threadStart = socket.sent.find((message) => message.method === 'thread/start')
        expect(threadStart).toMatchObject({
            params: {
                config: {
                    web_search: 'live',
                    tools: { web_search: true, view_image: false },
                    features: {
                        shell_tool: false,
                        standalone_web_search: true,
                    },
                },
            },
        })
        const turnStart = socket.sent.find((message) => message.method === 'turn/start')
        expect(turnStart).toMatchObject({ params: { effort: 'none' } })
    })

    it('联网搜索启动占位事件不应在真实查询返回前被误判为未批准操作', async () => {
        const approvedQuery = '通勤防晒 近期 官方'
        const socket = new FakeAppServerSocket(
            'webSearch',
            true,
            null,
            { query: approvedQuery },
            { ok: true },
            'completed',
            null,
            15,
            true,
        )

        await expect(
            runCodexAppServer(
                {
                    ...createRequest(),
                    images: [],
                    webSearch: true,
                },
                () => socket as unknown as WebSocket,
            ),
        ).resolves.toEqual({ ok: true })
    })

    it('联网资料请求接受当前 App Server 的批量查询 action', async () => {
        const approvedQueries = ['通勤防晒 近期 官方', '通勤防晒 消费趋势']
        const socket = new FakeAppServerSocket(
            'webSearch',
            true,
            null,
            {
                query: '',
                action: { type: 'search', queries: approvedQueries },
            },
            { ok: true },
        )

        await expect(
            runCodexAppServer(
                {
                    ...createRequest(),
                    images: [],
                    webSearch: true,
                },
                () => socket as unknown as WebSocket,
            ),
        ).resolves.toEqual({ ok: true })
    })

    it('接受不携带新网络目标的 other action', async () => {
        const approvedQuery = '通勤防晒 近期 官方'
        const socket = new FakeAppServerSocket(
            'webSearch',
            true,
            null,
            { query: approvedQuery, action: { type: 'search', query: approvedQuery } },
            { ok: true },
            'completed',
            null,
            15,
            false,
            7,
            [{ query: '', action: { type: 'other' } }],
        )

        await expect(
            runCodexAppServer(
                {
                    ...createRequest(),
                    images: [],
                    webSearch: true,
                },
                () => socket as unknown as WebSocket,
            ),
        ).resolves.toEqual({ ok: true })
    })

    it('联网资料请求允许改写查询但拒绝畸形查询和私有页面', async () => {
        const unapprovedQuerySocket = new FakeAppServerSocket(
            'webSearch',
            true,
            null,
            { query: '通勤场景 防晒建议 最新资料' },
            { ok: true },
        )
        await expect(
            runCodexAppServer(
                {
                    ...createRequest(),
                    images: [],
                    webSearch: true,
                },
                () => unapprovedQuerySocket as unknown as WebSocket,
            ),
        ).resolves.toEqual({ ok: true })

        const mixedQuerySocket = new FakeAppServerSocket(
            'webSearch',
            true,
            null,
            {
                query: '',
                action: {
                    type: 'search',
                    queries: ['通勤防晒 近期 官方', 'user@example.com 私人账号'],
                },
            },
            { ok: true },
        )
        await expect(
            runCodexAppServer(
                {
                    ...createRequest(),
                    images: [],
                    webSearch: true,
                },
                () => mixedQuerySocket as unknown as WebSocket,
            ),
        ).rejects.toMatchObject({ ruleId: 'codex-app-server.web-search-action' })

        const malformedQuerySocket = new FakeAppServerSocket(
            'webSearch',
            true,
            null,
            {
                query: '',
                action: { type: 'search', queries: '通勤防晒 近期 官方' },
            },
            { ok: true },
        )
        await expect(
            runCodexAppServer(
                {
                    ...createRequest(),
                    images: [],
                    webSearch: true,
                },
                () => malformedQuerySocket as unknown as WebSocket,
            ),
        ).rejects.toMatchObject({ ruleId: 'codex-app-server.web-search-action' })

        const privatePageSocket = new FakeAppServerSocket(
            'webSearch',
            true,
            null,
            { action: { type: 'openPage', url: 'https://127.0.0.1/private' } },
            { ok: true },
        )
        await expect(
            runCodexAppServer(
                {
                    ...createRequest(),
                    images: [],
                    webSearch: true,
                },
                () => privatePageSocket as unknown as WebSocket,
            ),
        ).rejects.toMatchObject({ ruleId: 'codex-app-server.web-search-action' })
    })

    it('完成初始化、无工具线程、结构化图文 turn 与用量解析', async () => {
        const socket = new FakeAppServerSocket()
        const socketFactory: CodexAppServerSocketFactory = vi.fn(
            () => socket as unknown as WebSocket,
        )

        const result = await runCodexAppServer(createRequest(), socketFactory)

        expect(result).toEqual({ ok: true })
        expect(readAgentProviderExecutionMetadata(result)).toEqual({
            executionId: 'remote-thread-1',
            usage: {
                inputTokens: 12,
                textInputTokens: null,
                imageInputTokens: null,
                cachedInputTokens: 7,
                reasoningTokens: 2,
                outputTokens: 3,
                totalTokens: 15,
            },
        })
        expect(socketFactory).toHaveBeenCalledWith('ws://127.0.0.1:14500', 'remote-test-token')
        expect(socket.sent.map((message) => message.method)).toEqual([
            'initialize',
            'initialized',
            'thread/start',
            'turn/start',
        ])
        const threadStart = socket.sent.find((message) => message.method === 'thread/start')
        expect(threadStart).toMatchObject({
            params: {
                approvalPolicy: 'never',
                sandbox: 'read-only',
                ephemeral: true,
                config: {
                    web_search: 'disabled',
                    mcp_servers: {},
                    features: {
                        shell_tool: false,
                        apps: false,
                        plugins: false,
                    },
                },
            },
        })
        const turnStart = socket.sent.find((message) => message.method === 'turn/start')
        expect(turnStart).toMatchObject({
            params: {
                sandboxPolicy: {
                    type: 'readOnly',
                    networkAccess: false,
                },
                input: [
                    { type: 'text', text: 'Return JSON' },
                    { type: 'image', url: 'data:image/png;base64,AQID' },
                ],
                outputSchema: createRequest().outputSchema,
            },
        })
        expect(
            (
                (turnStart?.params as Record<string, unknown>).sandboxPolicy as Record<
                    string,
                    unknown
                >
            ).access,
        ).toBeUndefined()
    })

    it('远程事件出现工具时立即按契约错误失败', async () => {
        const socket = new FakeAppServerSocket('commandExecution')

        await expect(
            runCodexAppServer(createRequest(), () => socket as unknown as WebSocket),
        ).rejects.toMatchObject({
            constructor: AgentContractError,
            ruleId: 'codex-app-server.no-tools',
        })

        expect(socket.sent.map((message) => message.method)).toContain('turn/interrupt')
    })

    it('累计用量超过联网调用预算时立即中断且保留实际计量', async () => {
        const socket = new FakeAppServerSocket(
            'agentMessage',
            true,
            null,
            { ok: true },
            null,
            'completed',
            null,
            15,
        )
        let failure: unknown

        try {
            await runCodexAppServer(
                { ...createRequest(), maxTotalTokens: 10 },
                () => socket as unknown as WebSocket,
            )
        } catch (error) {
            failure = error
        }

        expect(failure).toMatchObject({
            category: 'budget_exhausted',
            retryable: false,
            ruleId: 'codex-app-server.token-budget',
        })
        expect(readAgentProviderExecutionMetadata(failure)).toMatchObject({
            executionId: 'remote-thread-1',
            usage: { totalTokens: 15 },
        })
        expect(socket.sent.map((message) => message.method)).toContain('turn/interrupt')
    })

    it('取消信号会中断远程 turn 并关闭连接', async () => {
        const controller = new AbortController()
        const socket = new FakeAppServerSocket('agentMessage', false)
        const pending = runCodexAppServer(
            createRequest(controller.signal),
            () => socket as unknown as WebSocket,
        )
        await vi.waitFor(() => {
            expect(socket.sent.map((message) => message.method)).toContain('turn/start')
        })

        controller.abort('cancelled by test')

        await expect(pending).rejects.toMatchObject({
            category: 'cancelled',
        })
        expect(socket.sent.map((message) => message.method)).toContain('turn/interrupt')
        expect(socket.readyState).toBe(WebSocket.CLOSED)
    })

    it('连接建立期间取消不会留下悬挂调用', async () => {
        const controller = new AbortController()
        const socket = new NeverOpenSocket()
        const pending = runCodexAppServer(
            createRequest(controller.signal),
            () => socket as unknown as WebSocket,
        )

        controller.abort('cancelled while connecting')

        await expect(pending).rejects.toMatchObject({
            category: 'cancelled',
        })
        expect(socket.readyState).toBe(WebSocket.CLOSED)
    })

    it('App Server 参数协议不兼容时记录稳定配置错误分类', async () => {
        const socket = new FakeAppServerSocket('agentMessage', true, {
            code: -32600,
            message: 'Invalid request: unsupported field',
        })

        await expect(
            runCodexAppServer(createRequest(), () => socket as unknown as WebSocket),
        ).rejects.toMatchObject({
            category: 'configuration',
            retryable: false,
            validationFieldPaths: ['jsonrpc.request'],
            ruleId: 'codex-app-server.rpc.-32600',
        })
    })

    it('结构化输出 Schema 不兼容时记录稳定配置错误分类', async () => {
        const socket = new FakeAppServerSocket('agentMessage', true, null, null, null, 'failed', {
            message:
                '{"type":"error","error":{"code":"invalid_json_schema","message":"uniqueItems is not permitted"},"status":400}',
        })

        await expect(
            runCodexAppServer(createRequest(), () => socket as unknown as WebSocket),
        ).rejects.toMatchObject({
            category: 'configuration',
            retryable: false,
            validationFieldPaths: ['turn.outputSchema'],
            ruleId: 'codex-app-server.output-schema',
        })
    })

    it('推理强度配置无效时输出可直接定位的安全诊断', async () => {
        const socket = new FakeAppServerSocket('agentMessage', true, null, null, null, 'failed', {
            message:
                "[ReasoningEffortParam] [reasoning.effort] [invalid_enum_value] Invalid value: 'light'.",
        })

        await expect(
            runCodexAppServer(createRequest(), () => socket as unknown as WebSocket),
        ).rejects.toMatchObject({
            category: 'configuration',
            message: '远程 Codex 推理强度配置无效',
            retryable: false,
            validationFieldPaths: ['reasoning.effort'],
            ruleId: 'codex-app-server.reasoning-effort',
        })
    })

    it('未分类远端失败在 DEBUG 诊断中保留脱敏前的错误摘要', async () => {
        const socket = new FakeAppServerSocket('agentMessage', true, null, null, null, 'failed', {
            message: 'task-specific remote failure',
        })

        await expect(
            runCodexAppServer(createRequest(), () => socket as unknown as WebSocket),
        ).rejects.toMatchObject({
            category: 'unknown',
            debugDetails: {
                stage: 'codex-app-server.remote-failure',
                message: 'task-specific remote failure',
            },
        })
    })

    it('item/completed 缺失时从 turn/completed 的最终消息兜底', async () => {
        const socket = new FakeAppServerSocket('agentMessage', true, null, null, { ok: true })

        await expect(
            runCodexAppServer(createRequest(), () => socket as unknown as WebSocket),
        ).resolves.toEqual({ ok: true })
    })

    it('优先使用 item/completed，不被 turn/completed 的兜底消息覆盖', async () => {
        const socket = new FakeAppServerSocket(
            'agentMessage',
            true,
            null,
            { ok: true },
            { ok: false },
        )

        await expect(
            runCodexAppServer(createRequest(), () => socket as unknown as WebSocket),
        ).resolves.toEqual({ ok: true })
    })
})
