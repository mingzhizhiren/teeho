import { z } from 'zod'

import { validateCodexWebSearchItem } from '../research/analysis.codex-web-search'
import {
    AgentCancelledError,
    AgentContractError,
    AgentProviderError,
    attachAgentProviderExecutionMetadata,
    createAgentUnparseableOutput,
    type AgentProviderUsage,
    type AgentResultGenerationInput,
} from './analysis.provider'
import { normalizeAgentProviderUsage } from './analysis.provider-usage'

export interface CodexAppServerRequest {
    url: string
    token: string
    model: string
    /** 调用方已按实际模型能力收敛为 none 或 low。 */
    effort?: 'none' | 'low'
    prompt: string
    outputSchema: Record<string, unknown>
    images: AgentResultGenerationInput['images']
    signal: AbortSignal
    /** 仅正式分析前资料搜集可开启；其他调用保持禁用。 */
    webSearch?: boolean
    /** App Server 协议没有原生输出上限；通过累计用量通知实施绝对保险丝。 */
    maxTotalTokens?: number
}

export type CodexAppServerRunner = (request: CodexAppServerRequest) => Promise<unknown>

type RpcId = number | string

interface PendingRequest {
    resolve: (value: unknown) => void
    reject: (error: unknown) => void
}

const rpcMessageSchema = z
    .object({
        id: z.union([z.number(), z.string(), z.null()]).optional(),
        method: z.string().optional(),
        params: z.unknown().optional(),
        result: z.unknown().optional(),
        error: z
            .object({
                code: z.number(),
                message: z.string(),
                data: z.unknown().optional(),
            })
            .passthrough()
            .optional(),
    })
    .passthrough()

const threadStartResultSchema = z
    .object({
        thread: z.object({
            id: z.string().min(1),
        }),
    })
    .passthrough()

const turnStartResultSchema = z
    .object({
        turn: z.object({
            id: z.string().min(1),
        }),
    })
    .passthrough()

const itemNotificationSchema = z
    .object({
        threadId: z.string().optional(),
        turnId: z.string().optional(),
        item: z
            .object({
                type: z.string(),
            })
            .passthrough(),
    })
    .passthrough()

const turnCompletedSchema = z
    .object({
        turn: z
            .object({
                id: z.string(),
                status: z.enum(['completed', 'interrupted', 'failed']),
                error: z
                    .object({
                        message: z.string(),
                        codexErrorInfo: z.unknown().optional(),
                    })
                    .passthrough()
                    .nullable()
                    .optional(),
                items: z
                    .array(
                        z
                            .object({
                                type: z.string(),
                                text: z.string().optional(),
                            })
                            .passthrough(),
                    )
                    .optional(),
            })
            .passthrough(),
    })
    .passthrough()

const tokenUsageSchema = z
    .object({
        tokenUsage: z.object({
            total: z.object({
                inputTokens: z.number().int().nonnegative(),
                cachedInputTokens: z.number().int().nonnegative().optional(),
                cacheWriteInputTokens: z.number().int().nonnegative().optional(),
                outputTokens: z.number().int().nonnegative(),
                reasoningOutputTokens: z.number().int().nonnegative().optional(),
                totalTokens: z.number().int().nonnegative(),
            }),
        }),
    })
    .passthrough()

const allowedRemoteItemTypes = new Set(['userMessage', 'agentMessage', 'reasoning'])
const codexAppServerErrorCodes = {
    invalidRequest: -32600,
    methodNotFound: -32601,
    invalidParams: -32602,
    rateLimited: -32001,
} as const

function createTokenBudgetExceededError(
    executionId: string | null,
    usage: AgentProviderUsage | null,
    maxTotalTokens: number,
) {
    const error = new AgentProviderError('budget_exhausted', {
        message: 'Codex 联网调用已达到 Token 预算上限',
        retryable: false,
        validationFieldPaths: ['usage.totalTokens'],
        ruleId: 'codex-app-server.token-budget',
        debugDetails: { maxTotalTokens, reportedTotalTokens: usage?.totalTokens },
    })
    attachAgentProviderExecutionMetadata(error, { executionId, usage })
    return error
}

/** 把远程 App Server 错误归类为稳定的 Provider 错误 */
function classifyRemoteFailure(message: string, code?: number) {
    const normalized = message.toLocaleLowerCase()
    if (
        /reasoning(?:\.effort|_effort)|reasoningeffortparam/u.test(normalized) &&
        /invalid_enum_value|invalid value/u.test(normalized)
    ) {
        return new AgentProviderError('configuration', {
            message: '远程 Codex 推理强度配置无效',
            diagnosticMessage: '远程 Codex 推理强度配置无效',
            retryable: false,
            validationFieldPaths: ['reasoning.effort'],
            ruleId: 'codex-app-server.reasoning-effort',
            cause: new Error(message),
        })
    }
    if (
        code === codexAppServerErrorCodes.invalidRequest ||
        code === codexAppServerErrorCodes.methodNotFound ||
        code === codexAppServerErrorCodes.invalidParams
    ) {
        return new AgentProviderError('configuration', {
            message: '远程 Codex App Server 协议不兼容',
            retryable: false,
            validationFieldPaths: ['jsonrpc.request'],
            ruleId: `codex-app-server.rpc.${code}`,
            cause: new Error(message),
        })
    }
    if (/invalid_json_schema|invalid schema for response_format/u.test(normalized)) {
        return new AgentProviderError('configuration', {
            message: '远程 Codex 结构化输出配置无效',
            retryable: false,
            validationFieldPaths: ['turn.outputSchema'],
            ruleId: 'codex-app-server.output-schema',
            cause: new Error(message),
        })
    }
    if (
        code === codexAppServerErrorCodes.rateLimited ||
        /429|rate.?limit|too many requests|overload/u.test(normalized)
    ) {
        return new AgentProviderError('rate_limited', {
            message: '远程 Codex 请求受到限流',
            retryable: true,
        })
    }
    if (/401|403|unauthori[sz]ed|authentication|invalid token|forbidden/u.test(normalized)) {
        return new AgentProviderError('authentication', {
            message: '远程 Codex 身份验证失败',
            retryable: false,
        })
    }
    if (/unsupported|does not support|capabilit|image input/u.test(normalized)) {
        return new AgentProviderError('capability', {
            message: '远程 Codex 当前模型不支持任务能力',
            retryable: false,
        })
    }
    if (
        /timeout|timed out|503|502|connection|temporar|unavailable|closed|network/u.test(normalized)
    ) {
        return new AgentProviderError('temporary_unavailable', {
            message: '远程 Codex 暂时不可用',
            retryable: true,
        })
    }
    return new AgentProviderError('unknown', {
        message: '远程 Codex 执行失败',
        retryable: false,
        cause: new Error(message),
        debugDetails: {
            stage: 'codex-app-server.remote-failure',
            message,
        },
    })
}

/** 从远程消息载荷中读取可显示的文本 */
function readMessageText(data: unknown): Promise<string> {
    if (typeof data === 'string') {
        return Promise.resolve(data)
    }
    if (data instanceof ArrayBuffer) {
        return Promise.resolve(new TextDecoder().decode(data))
    }
    if (ArrayBuffer.isView(data)) {
        return Promise.resolve(
            new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)),
        )
    }
    if (data instanceof Blob) {
        return data.text()
    }
    return Promise.reject(
        new AgentContractError('远程 Codex 返回了无法识别的消息类型', {
            validationFieldPaths: ['websocket.message.data'],
            ruleId: 'codex-app-server.message-type',
        }),
    )
}

/** 创建并初始化 App Server WebSocket 连接 */
function createRemoteSocket(url: string, token: string): WebSocket {
    // TypeScript 优先选择 DOM 构造签名；Bun 运行时额外支持带 headers 的构造参数。
    const BunWebSocket = WebSocket as typeof WebSocket & {
        new (url: string | URL, options?: Bun.WebSocketOptions): WebSocket
    }
    return new BunWebSocket(url, {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    })
}

export type CodexAppServerSocketFactory = (url: string, token: string) => WebSocket

/** 通过 Codex App Server WebSocket 协议执行一次无工具结构化生成。 */
export async function runCodexAppServer(
    request: CodexAppServerRequest,
    socketFactory: CodexAppServerSocketFactory = createRemoteSocket,
): Promise<unknown> {
    if (request.signal.aborted) {
        throw new AgentCancelledError('远程 Codex 调用已取消', request.signal.reason)
    }
    const isAllowedItemType = (itemType: string) =>
        allowedRemoteItemTypes.has(itemType) ||
        (request.webSearch === true && itemType === 'webSearch')
    let socket: WebSocket
    try {
        socket = socketFactory(request.url, request.token)
    } catch (error) {
        throw new AgentProviderError('configuration', {
            message: '远程 Codex WebSocket 无法创建',
            retryable: false,
            cause: error,
        })
    }

    let nextRequestId = 1
    let threadId: string | null = null
    let turnId: string | null = null
    let finalMessage: string | null = null
    let usage: AgentProviderUsage | null = null
    let settled = false
    /** 拒绝尚未完成的连接建立等待 */
    let rejectOpened: (error: unknown) => void = () => {}
    const pendingRequests = new Map<RpcId, PendingRequest>()

    let resolveCompletion!: (value: unknown) => void
    let rejectCompletion!: (error: unknown) => void
    const completion = new Promise<unknown>((resolve, reject) => {
        resolveCompletion = resolve
        rejectCompletion = reject
    })
    // 连接可能在 turn/start 前失败；提前挂载拒绝处理，避免终止分支产生未处理 Promise。
    void completion.catch(() => {})

    /** 拒绝所有仍在等待响应的远程请求 */
    const rejectAll = (error: unknown) => {
        attachAgentProviderExecutionMetadata(error, { executionId: threadId, usage })
        for (const pending of pendingRequests.values()) {
            pending.reject(error)
        }
        pendingRequests.clear()
        if (!settled) {
            settled = true
            rejectCompletion(error)
        }
    }

    /** 向 App Server 发送无需响应的 JSON-RPC 通知 */
    const sendNotification = (method: string, params: unknown) => {
        socket.send(JSON.stringify({ method, params }))
    }

    /** 发送 JSON-RPC 请求并跟踪对应响应 */
    const sendRequest = (method: string, params: unknown) => {
        const id = nextRequestId++
        return new Promise<unknown>((resolve, reject) => {
            pendingRequests.set(id, { resolve, reject })
            try {
                socket.send(JSON.stringify({ id, method, params }))
            } catch (error) {
                pendingRequests.delete(id)
                reject(
                    classifyRemoteFailure(
                        error instanceof Error ? error.message : 'WebSocket send failed',
                    ),
                )
            }
        })
    }

    /** 请求 App Server 中断当前执行回合 */
    const interrupt = () => {
        if (threadId && turnId && socket.readyState === WebSocket.OPEN) {
            try {
                socket.send(
                    JSON.stringify({
                        id: nextRequestId++,
                        method: 'turn/interrupt',
                        params: { threadId, turnId },
                    }),
                )
            } catch {
                // 连接关闭时无法再发送中断；关闭连接仍会终止本次客户端调用。
            }
        }
    }

    /** 拒绝服务端发起的不受支持工具调用 */
    const rejectToolEvent = (itemType: string) => {
        interrupt()
        rejectAll(
            new AgentContractError('远程 Codex 不得调用工具', {
                validationFieldPaths: ['events.item.type'],
                ruleId: 'codex-app-server.no-tools',
                cause: new Error(`Unexpected item type: ${itemType}`),
            }),
        )
    }

    /** 分发 App Server 推送的执行通知 */
    const handleNotification = (method: string, params: unknown) => {
        if (method === 'item/started' || method === 'item/completed') {
            const parsed = itemNotificationSchema.safeParse(params)
            if (!parsed.success) {
                rejectAll(
                    new AgentContractError('远程 Codex 项目事件无效', {
                        validationFieldPaths: ['events.item'],
                        ruleId: 'codex-app-server.item',
                        cause: parsed.error,
                    }),
                )
                return
            }
            const item = parsed.data.item
            threadId = parsed.data.threadId ?? threadId
            turnId = parsed.data.turnId ?? turnId
            if (!isAllowedItemType(item.type)) {
                rejectToolEvent(item.type)
                return
            }
            const webSearchValidation =
                item.type === 'webSearch'
                    ? validateCodexWebSearchItem(item, method === 'item/started')
                    : null
            if (webSearchValidation && !webSearchValidation.isAllowed) {
                interrupt()
                rejectAll(
                    new AgentContractError('远程 Codex 发起了未批准的联网操作', {
                        validationFieldPaths: ['events.item.action'],
                        ruleId: 'codex-app-server.web-search-action',
                        debugDetails: webSearchValidation.debugDetails,
                    }),
                )
                return
            }
            if (
                method === 'item/completed' &&
                item.type === 'agentMessage' &&
                typeof item.text === 'string'
            ) {
                finalMessage = item.text
            }
            return
        }

        if (method === 'thread/tokenUsage/updated') {
            const parsed = tokenUsageSchema.safeParse(params)
            if (parsed.success) {
                usage = normalizeAgentProviderUsage({
                    inputTokens: parsed.data.tokenUsage.total.inputTokens,
                    cachedInputTokens: parsed.data.tokenUsage.total.cachedInputTokens,
                    outputTokens: parsed.data.tokenUsage.total.outputTokens,
                    reasoningTokens: parsed.data.tokenUsage.total.reasoningOutputTokens,
                    totalTokens: parsed.data.tokenUsage.total.totalTokens,
                })
                const reportedTotalTokens = usage?.totalTokens
                if (
                    request.maxTotalTokens !== undefined &&
                    typeof reportedTotalTokens === 'number' &&
                    reportedTotalTokens > request.maxTotalTokens
                ) {
                    interrupt()
                    rejectAll(
                        createTokenBudgetExceededError(threadId, usage, request.maxTotalTokens),
                    )
                }
            }
            return
        }

        if (method !== 'turn/completed') {
            return
        }
        const parsed = turnCompletedSchema.safeParse(params)
        if (!parsed.success) {
            rejectAll(
                new AgentContractError('远程 Codex 完成事件无效', {
                    validationFieldPaths: ['events.turn.completed'],
                    ruleId: 'codex-app-server.turn-completed',
                    cause: parsed.error,
                }),
            )
            return
        }
        if (turnId && parsed.data.turn.id !== turnId) {
            return
        }
        if (parsed.data.turn.status === 'interrupted') {
            rejectAll(new AgentCancelledError('远程 Codex 调用已取消'))
            return
        }
        if (parsed.data.turn.status === 'failed') {
            rejectAll(classifyRemoteFailure(parsed.data.turn.error?.message ?? 'unknown failure'))
            return
        }
        const completedItems = parsed.data.turn.items ?? []
        for (const item of completedItems) {
            if (!isAllowedItemType(item.type)) {
                rejectToolEvent(item.type)
                return
            }
            const webSearchValidation =
                item.type === 'webSearch'
                    ? validateCodexWebSearchItem(item as Record<string, unknown>, false)
                    : null
            if (webSearchValidation && !webSearchValidation.isAllowed) {
                interrupt()
                rejectAll(
                    new AgentContractError('远程 Codex 发起了未批准的联网操作', {
                        validationFieldPaths: ['events.turn.items.action'],
                        ruleId: 'codex-app-server.web-search-action',
                        debugDetails: webSearchValidation.debugDetails,
                    }),
                )
                return
            }
        }
        if (!finalMessage) {
            for (let index = completedItems.length - 1; index >= 0; index -= 1) {
                const item = completedItems[index]
                if (item.type === 'agentMessage' && typeof item.text === 'string') {
                    finalMessage = item.text
                    break
                }
            }
        }
        if (!finalMessage) {
            rejectAll(
                new AgentContractError('远程 Codex 没有返回最终结构化结果', {
                    validationFieldPaths: ['events.agentMessage'],
                    ruleId: 'codex-app-server.final-message',
                }),
            )
            return
        }
        try {
            const result = attachAgentProviderExecutionMetadata(
                JSON.parse(finalMessage) as unknown,
                {
                    executionId: threadId,
                    usage,
                },
            )
            settled = true
            resolveCompletion(result)
        } catch {
            const result = attachAgentProviderExecutionMetadata(
                createAgentUnparseableOutput(finalMessage),
                { executionId: threadId, usage },
            )
            settled = true
            resolveCompletion(result)
        }
    }

    const opened = new Promise<void>((resolve, reject) => {
        rejectOpened = reject
        socket.addEventListener(
            'open',
            () => {
                resolve()
            },
            { once: true },
        )
        socket.addEventListener(
            'error',
            () => {
                reject(
                    new AgentProviderError('temporary_unavailable', {
                        message: '无法连接远程 Codex',
                        retryable: true,
                    }),
                )
            },
            { once: true },
        )
    })

    socket.addEventListener('message', (event) => {
        void readMessageText(event.data)
            .then((text) => {
                let parsedJson: unknown
                try {
                    parsedJson = JSON.parse(text) as unknown
                } catch (error) {
                    throw new AgentContractError('远程 Codex JSON-RPC 消息不是 JSON', {
                        validationFieldPaths: ['websocket.message'],
                        ruleId: 'codex-app-server.json',
                        cause: error,
                    })
                }
                const parsed = rpcMessageSchema.safeParse(parsedJson)
                if (!parsed.success) {
                    throw new AgentContractError('远程 Codex JSON-RPC 消息无效', {
                        validationFieldPaths: ['websocket.message'],
                        ruleId: 'codex-app-server.json-rpc',
                        cause: parsed.error,
                    })
                }
                const message = parsed.data
                if (message.method && message.id !== undefined && message.id !== null) {
                    rejectToolEvent(message.method)
                    return
                }
                if (message.method) {
                    handleNotification(message.method, message.params)
                    return
                }
                if (message.id === undefined || message.id === null) {
                    throw new AgentContractError('远程 Codex JSON-RPC 响应缺少 id', {
                        validationFieldPaths: ['websocket.message.id'],
                        ruleId: 'codex-app-server.response-id',
                    })
                }
                const pending = pendingRequests.get(message.id)
                if (!pending) {
                    return
                }
                pendingRequests.delete(message.id)
                if (message.error) {
                    pending.reject(classifyRemoteFailure(message.error.message, message.error.code))
                    return
                }
                pending.resolve(message.result)
            })
            .catch((error) => rejectAll(error))
    })

    socket.addEventListener('close', (event) => {
        if (!settled) {
            const error = classifyRemoteFailure(
                event.reason || `WebSocket closed with code ${event.code}`,
            )
            rejectOpened(error)
            rejectAll(error)
        }
    })

    /** 中止远程执行并清理连接与待处理请求 */
    const abort = () => {
        interrupt()
        const error = new AgentCancelledError('远程 Codex 调用已取消', request.signal.reason)
        rejectOpened(error)
        rejectAll(error)
        socket.close()
    }
    request.signal.addEventListener('abort', abort, { once: true })

    try {
        await opened
        await sendRequest('initialize', {
            clientInfo: {
                name: 'teeho',
                title: 'Teeho',
                version: '0.1.0',
            },
        })
        sendNotification('initialized', {})
        const threadResult = threadStartResultSchema.parse(
            await sendRequest('thread/start', {
                model: request.model,
                approvalPolicy: 'never',
                sandbox: 'read-only',
                ephemeral: true,
                serviceName: 'teeho',
                config: {
                    approval_policy: 'never',
                    web_search: request.webSearch ? 'live' : 'disabled',
                    mcp_servers: {},
                    shell_environment_policy: { inherit: 'none' },
                    tools: {
                        web_search: request.webSearch === true,
                        view_image: false,
                    },
                    features: {
                        shell_tool: false,
                        apps: false,
                        browser_use: false,
                        browser_use_external: false,
                        browser_use_full_cdp_access: false,
                        in_app_browser: false,
                        computer_use: false,
                        image_generation: false,
                        plugins: false,
                        multi_agent: false,
                        multi_agent_v2: false,
                        code_mode_host: false,
                        standalone_web_search: request.webSearch === true,
                    },
                },
            }),
        )
        threadId = threadResult.thread.id

        const turnResult = turnStartResultSchema.parse(
            await sendRequest('turn/start', {
                threadId,
                model: request.model,
                effort: request.effort ?? (request.webSearch ? 'none' : 'low'),
                approvalPolicy: 'never',
                sandboxPolicy: {
                    type: 'readOnly',
                    networkAccess: false,
                },
                outputSchema: request.outputSchema,
                input: [
                    { type: 'text', text: request.prompt },
                    ...request.images.map((image) => ({
                        type: 'image',
                        url: `data:${image.mediaType};base64,${Buffer.from(image.content).toString('base64')}`,
                    })),
                ],
            }),
        )
        turnId = turnResult.turn.id
        return await completion
    } catch (error) {
        if (error instanceof z.ZodError) {
            throw new AgentContractError('远程 Codex JSON-RPC 响应不符合协议', {
                validationFieldPaths: error.issues.map((issue) => issue.path.join('.')),
                ruleId: 'codex-app-server.response',
                cause: error,
            })
        }
        throw error
    } finally {
        request.signal.removeEventListener('abort', abort)
        for (const pending of pendingRequests.values()) {
            pending.reject(new AgentCancelledError('远程 Codex 连接已关闭', request.signal.reason))
        }
        pendingRequests.clear()
        socket.close()
    }
}
