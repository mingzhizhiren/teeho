import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { checkupVersions } from '../checkup/analysis.checkup.constants'
import { comparisonExplanationJsonSchema } from '../checkup/analysis.comparison-explanation'
import {
    materialJsonSchema,
    materialPrompt,
    materialPromptVersions,
    type MaterialUnderstandingInput,
} from '../materials/analysis.material'
import type {
    WebResearchCollectionInput,
    WebResearchProvider,
} from '../research/analysis.research-provider'
import {
    codexPromptCacheContracts,
    createCodexRequestDiagnostics,
    type CodexRequestDiagnosticContext,
} from './analysis.prompt-cache'
import { agentPromptCatalog } from './analysis.prompt.constants'
import {
    AgentCancelledError,
    AgentContractError,
    AgentProviderError,
    attachAgentProviderExecutionMetadata,
    createAgentUnparseableOutput,
    readAgentProviderExecutionMetadata,
    validateAgentImagesForProvider,
    validateAgentVideoEvidenceForProvider,
    type AgentConversationTurnInput,
    type AgentOutputRepairInput,
    type AgentProvider,
    type AgentProviderUsage,
    type AgentResultGenerationInput,
} from './analysis.provider'
import {
    conversationTurnJsonSchema,
    createConversationTurnPrompt,
    createGenerateResultPrompt,
    createRepairResultJsonSchema,
    createRepairResultPrompt,
    generateResultJsonSchema,
} from './analysis.provider-prompts'

import { isSafeWebResearchQuery } from '../research/analysis.web-research'
import {
    createWebResearchPrompt,
    webResearchJsonSchema,
} from '../research/analysis.web-research-prompts'
import { runCodexAppServer, type CodexAppServerRunner } from './analysis.codex-app-server'
import { normalizeAgentProviderUsage } from './analysis.provider-usage'

interface CodexCliProviderSharedOptions {
    executablePath: string
    model: string
    /** 任务受理前使用；留空由调用方兼容旧单模型构造。 */
    taskFormationModel?: string
}

export type CodexReasoningEffort = 'none' | 'low'
export type CodexReasoningProfile = 'standard' | 'lowest'

const confirmedNoneReasoningModelPattern = /^gpt-5\.(?:4|5|6)(?:$|-)/u

/** 未确认支持 none 的模型保守使用 low，绝不尝试更高 effort。 */
export function resolveCodexReasoningEffort(
    model: string,
    profile: CodexReasoningProfile,
): CodexReasoningEffort {
    return profile === 'lowest' && confirmedNoneReasoningModelPattern.test(model) ? 'none' : 'low'
}

interface CodexStageExecution {
    readonly model: string
    readonly effort: CodexReasoningEffort
}

export type CodexCliProviderOptions =
    | (CodexCliProviderSharedOptions & {
          mode?: 'local'
          remoteUrl?: never
          remoteToken?: never
      })
    | (CodexCliProviderSharedOptions & {
          mode: 'remote'
          remoteUrl: string
          remoteToken: string
      })

interface CodexProcessRequest {
    executablePath: string
    args: string[]
    cwd: string
    stdin: string
    signal: AbortSignal
    onStdoutLine?: (line: string) => void
}

interface CodexProcessResult {
    exitCode: number
    stdout: string
    stderr: string
}

interface CodexCommandResolutionDependencies {
    platform: NodeJS.Platform
    which: (executable: string) => string | null
    exists: (path: string) => boolean
}

const systemCodexCommandResolutionDependencies: CodexCommandResolutionDependencies = {
    platform: process.platform,
    which: (executable) => Bun.which(executable),
    exists: existsSync,
}

/** Windows npm shim 会破坏复杂 `-c` 参数引号；改由 Node 入口转交原生 Codex。 */
export function resolveCodexProcessCommand(
    executablePath: string,
    args: readonly string[],
    dependencies: CodexCommandResolutionDependencies = systemCodexCommandResolutionDependencies,
): string[] {
    const resolved = dependencies.which(executablePath) ?? executablePath
    if (dependencies.platform !== 'win32' || !/\.(?:cmd|ps1)$/iu.test(resolved)) {
        return [resolved, ...args]
    }
    const nodeEntrypoint = path.join(
        path.dirname(resolved),
        'node_modules',
        '@openai',
        'codex',
        'bin',
        'codex.js',
    )
    if (!dependencies.exists(nodeEntrypoint)) return [resolved, ...args]
    return [dependencies.which('node') ?? 'node', nodeEntrypoint, ...args]
}

export type CodexProcessRunner = (request: CodexProcessRequest) => Promise<CodexProcessResult>

const allowedNonToolItemTypes = new Set(['agent_message', 'reasoning'])

function attachRequestDiagnostics(
    value: unknown,
    inputDiagnostics: ReturnType<typeof createCodexRequestDiagnostics>,
): unknown {
    const metadata = readAgentProviderExecutionMetadata(value)
    return attachAgentProviderExecutionMetadata(value, {
        executionId: metadata?.executionId ?? null,
        usage: metadata?.usage ?? null,
        inputDiagnostics,
    })
}

async function readProcessStream(
    stream: ReadableStream<Uint8Array>,
    onLine?: (line: string) => void,
) {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let result = ''
    let pending = ''
    while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        result += chunk
        pending += chunk
        let newline = pending.indexOf('\n')
        while (newline >= 0) {
            const line = pending.slice(0, newline).replace(/\r$/u, '')
            pending = pending.slice(newline + 1)
            onLine?.(line)
            newline = pending.indexOf('\n')
        }
    }
    const finalChunk = decoder.decode()
    result += finalChunk
    pending += finalChunk
    if (pending) onLine?.(pending.replace(/\r$/u, ''))
    return result
}

/** 启动 Codex CLI 子进程并收集标准输出与错误输出 */
async function runCodexProcess(request: CodexProcessRequest): Promise<CodexProcessResult> {
    let processHandle: ReturnType<typeof Bun.spawn>
    try {
        processHandle = Bun.spawn(
            resolveCodexProcessCommand(request.executablePath, request.args),
            {
                cwd: request.cwd,
                env: process.env,
                stdin: 'pipe',
                stdout: 'pipe',
                stderr: 'pipe',
            },
        )
    } catch (error) {
        throw new AgentProviderError('cli_missing', {
            message: 'Codex CLI 无法启动',
            retryable: false,
            cause: error,
        })
    }

    /** 在取消时终止正在运行的 Codex CLI 子进程 */
    const abort = () => processHandle.kill()
    request.signal.addEventListener('abort', abort, { once: true })
    try {
        const stdin = processHandle.stdin
        const stdoutStream = processHandle.stdout
        const stderrStream = processHandle.stderr
        if (
            stdin === undefined ||
            typeof stdin === 'number' ||
            stdoutStream === undefined ||
            typeof stdoutStream === 'number' ||
            stderrStream === undefined ||
            typeof stderrStream === 'number'
        ) {
            throw new AgentProviderError('configuration', {
                message: 'Codex CLI 子进程管道不可用',
                retryable: false,
            })
        }
        stdin.write(request.stdin)
        stdin.end()
        let result: [string, string, number]
        try {
            result = await Promise.all([
                readProcessStream(stdoutStream, request.onStdoutLine),
                new Response(stderrStream).text(),
                processHandle.exited,
            ])
        } catch (error) {
            processHandle.kill()
            await processHandle.exited.catch(() => undefined)
            throw error
        }
        const [stdout, stderr, exitCode] = result
        if (request.signal.aborted) {
            throw new AgentCancelledError('Codex CLI 调用已取消', request.signal.reason)
        }
        return { stdout, stderr, exitCode }
    } finally {
        request.signal.removeEventListener('abort', abort)
    }
}

/** 把 Codex CLI 失败归类为稳定的 Provider 错误 */
function classifyCodexFailure(result: CodexProcessResult) {
    const message = result.stderr.toLocaleLowerCase()
    if (/unknown configuration field|error loading config|invalid configuration/u.test(message)) {
        return new AgentProviderError('configuration', {
            message: 'Codex CLI 配置与当前版本不兼容',
            retryable: false,
            ruleId: 'codex-cli.configuration',
        })
    }
    if (/unexpected argument|unknown option|unrecognized (?:argument|option)/u.test(message)) {
        return new AgentProviderError('configuration', {
            message: 'Codex CLI 参数与当前版本不兼容',
            retryable: false,
            ruleId: 'codex-cli.arguments',
        })
    }
    if (/working directory|current directory|permission denied|access is denied/u.test(message)) {
        return new AgentProviderError('configuration', {
            message: 'Codex CLI 隔离工作目录不可用',
            retryable: false,
            ruleId: 'codex-cli.working-directory',
        })
    }
    if (/invalid.*(?:json )?schema|(?:json )?schema.*(?:invalid|unsupported)/u.test(message)) {
        return new AgentProviderError('configuration', {
            message: 'Codex CLI 结构化输出 Schema 不兼容',
            retryable: false,
            ruleId: 'codex-cli.output-schema',
        })
    }
    if (/enoent|not found|cannot find|无法找到|不是内部或外部命令/u.test(message)) {
        return new AgentProviderError('cli_missing', {
            message: 'Codex CLI 不存在或不可执行',
            retryable: false,
        })
    }
    if (/401|403|unauthori[sz]ed|authentication|login required|api key/u.test(message)) {
        return new AgentProviderError('authentication', {
            message: 'Codex CLI 身份验证失败',
            retryable: false,
        })
    }
    if (/429|rate.?limit|too many requests/u.test(message)) {
        return new AgentProviderError('rate_limited', {
            message: 'Codex CLI 请求受到限流',
            retryable: true,
        })
    }
    if (/unsupported|does not support|capabilit|image input/u.test(message)) {
        return new AgentProviderError('capability', {
            message: 'Codex CLI 当前模型不支持任务能力',
            retryable: false,
        })
    }
    if (/timeout|timed out|503|502|connection|temporar|unavailable/u.test(message)) {
        return new AgentProviderError('temporary_unavailable', {
            message: 'Codex CLI 暂时不可用',
            retryable: true,
        })
    }
    return new AgentProviderError('unknown', {
        message: 'Codex CLI 执行失败',
        retryable: false,
        debugDetails: {
            stage: 'codex-cli.exit',
            exitCode: result.exitCode,
            stdoutCharacterCount: Array.from(result.stdout).length,
            stderrCharacterCount: Array.from(result.stderr).length,
        },
    })
}

/** 从 Codex 事件中读取执行标识 */
function readExecutionId(event: Record<string, unknown>) {
    const value = event.thread_id ?? event.threadId ?? event.run_id ?? event.runId
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** 从 Codex 事件中读取令牌用量 */
function readUsage(event: Record<string, unknown>): AgentProviderUsage | null {
    return normalizeAgentProviderUsage(event.usage)
}

function createCliTokenBudgetExceededError(
    executionId: string | null,
    usage: AgentProviderUsage | null,
    maxTotalTokens: number,
) {
    const error = new AgentProviderError('budget_exhausted', {
        message: 'Codex 联网调用已达到 Token 预算上限',
        retryable: false,
        validationFieldPaths: ['usage.totalTokens'],
        ruleId: 'codex-cli.token-budget',
        debugDetails: { maxTotalTokens, reportedTotalTokens: usage?.totalTokens },
    })
    attachAgentProviderExecutionMetadata(error, { executionId, usage })
    return error
}

function createCliUsageBudgetMonitor(maxTotalTokens: number) {
    let executionId: string | null = null
    let usage: AgentProviderUsage | null = null
    return (line: string) => {
        if (!line.trim()) return
        let event: unknown
        try {
            event = JSON.parse(line) as unknown
        } catch {
            return
        }
        if (typeof event !== 'object' || event === null || Array.isArray(event)) return
        executionId = readExecutionId(event as Record<string, unknown>) ?? executionId
        usage = readUsage(event as Record<string, unknown>) ?? usage
        if (typeof usage?.totalTokens === 'number' && usage.totalTokens > maxTotalTokens) {
            throw createCliTokenBudgetExceededError(executionId, usage, maxTotalTokens)
        }
    }
}

/** 解析 Codex CLI 输出的逐行 JSON 事件 */
function parseCodexJsonLines(
    stdout: string,
    webSearchQueries: readonly string[] = [],
    maxTotalTokens?: number,
) {
    let finalMessage: string | undefined
    let executionId: string | null = null
    let usage: AgentProviderUsage | null = null
    for (const [index, line] of stdout.split(/\r?\n/u).entries()) {
        if (!line.trim()) {
            continue
        }
        let event: Record<string, unknown>
        try {
            const parsed = JSON.parse(line) as unknown
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                throw new Error('event is not an object')
            }
            event = parsed as Record<string, unknown>
        } catch (error) {
            throw new AgentContractError('Codex CLI JSONL 事件无效', {
                validationFieldPaths: [`events.${index}`],
                ruleId: 'codex-cli.jsonl',
                cause: error,
            })
        }

        executionId = readExecutionId(event) ?? executionId
        usage = readUsage(event) ?? usage
        if (
            maxTotalTokens !== undefined &&
            typeof usage?.totalTokens === 'number' &&
            usage.totalTokens > maxTotalTokens
        ) {
            throw createCliTokenBudgetExceededError(executionId, usage, maxTotalTokens)
        }

        if (typeof event.item === 'object' && event.item) {
            const item = event.item as Record<string, unknown>
            const webSearch = webSearchQueries.length > 0
            const allowedItem =
                typeof item.type === 'string' &&
                (allowedNonToolItemTypes.has(item.type) ||
                    (webSearch && item.type === 'web_search'))
            if (!allowedItem) {
                throw new AgentContractError('Codex CLI 不得调用工具', {
                    validationFieldPaths: ['events.item.type'],
                    ruleId: 'codex-cli.no-tools',
                })
            }
            if (item.type === 'web_search') {
                const action =
                    typeof item.action === 'object' && item.action
                        ? (item.action as Record<string, unknown>)
                        : null
                const query =
                    typeof item.query === 'string'
                        ? item.query
                        : typeof action?.query === 'string'
                          ? action.query
                          : null
                if (!query || !isSafeWebResearchQuery(query)) {
                    throw new AgentContractError('Codex CLI 发起了不安全的联网查询', {
                        validationFieldPaths: ['events.item.query'],
                        ruleId: 'codex-cli.web-search-query',
                    })
                }
            }
            if (
                event.type === 'item.completed' &&
                item.type === 'agent_message' &&
                typeof item.text === 'string'
            ) {
                finalMessage = item.text
            }
        }
    }

    if (!finalMessage) {
        throw new AgentContractError('Codex CLI 没有返回最终结构化结果', {
            validationFieldPaths: ['events.agent_message'],
            ruleId: 'codex-cli.final-message',
        })
    }
    try {
        return attachAgentProviderExecutionMetadata(JSON.parse(finalMessage) as unknown, {
            executionId,
            usage,
        })
    } catch {
        return attachAgentProviderExecutionMetadata(createAgentUnparseableOutput(finalMessage), {
            executionId,
            usage,
        })
    }
}

/** 把图片 MIME 类型映射为临时文件扩展名 */
function imageExtension(mediaType: AgentResultGenerationInput['images'][number]['mediaType']) {
    switch (mediaType) {
        case 'image/jpeg':
            return '.jpg'
        case 'image/png':
            return '.png'
        case 'image/webp':
            return '.webp'
    }
}

/** 使用 Codex 登录态的统一 Provider；可选择本地 CLI 或远程 App Server。 */
export class CodexCliAgentProvider implements AgentProvider, WebResearchProvider {
    /**
     * 创建使用 Codex CLI 或 App Server 执行分析任务的 Provider。
     * @param options Codex 执行模式、模型、超时及工作目录配置
     * @param processRunner 本地 CLI 进程执行器，主要用于替换测试实现
     * @param appServerRunner 远程 App Server 执行器，主要用于替换测试实现
     */
    constructor(
        private readonly options: CodexCliProviderOptions,
        private readonly processRunner: CodexProcessRunner = runCodexProcess,
        private readonly appServerRunner: CodexAppServerRunner = runCodexAppServer,
    ) {}

    formConversationTurn(input: AgentConversationTurnInput): Promise<unknown> {
        return this.execute(
            createConversationTurnPrompt(input),
            conversationTurnJsonSchema,
            [],
            input.signal,
            this.taskFormationExecution('standard'),
            {
                stage: 'form_conversation_turn',
                promptVersion: agentPromptCatalog.formConversationTurn.version,
                historyTexts: input.history.map((message) => message.text),
                ...codexPromptCacheContracts.form_conversation_turn,
            },
        )
    }

    /** 正式分析受理后执行一次允许联网、仍禁止其他工具的资料搜集。 */
    collect(input: WebResearchCollectionInput): Promise<unknown> {
        return this.execute(
            createWebResearchPrompt(input),
            webResearchJsonSchema,
            [],
            input.signal,
            this.analysisExecution('lowest'),
            {
                stage: 'collect_web_research',
                promptVersion: agentPromptCatalog.collectWebResearch.version,
                ...codexPromptCacheContracts.collect_web_research,
            },
            undefined,
            input.queryPlan.queries,
            input.tokenBudget,
        )
    }

    /**
     * 根据已解析的任务字段和证据生成最终分析结果。
     * @param input 结果生成所需的任务上下文、证据、图片及取消信号
     */
    understandMaterial(input: MaterialUnderstandingInput): Promise<unknown> {
        return this.execute(
            materialPrompt(input),
            materialJsonSchema(input.kind),
            input.images,
            input.signal,
            this.analysisExecution('standard'),
            {
                stage: 'generate_result',
                promptVersion: materialPromptVersions[input.kind],
                ...codexPromptCacheContracts.generate_result,
                schemaVersion: `material-${input.kind}.schema.v1`,
            },
            input.videoEvidence,
        )
    }

    generateResult(input: AgentResultGenerationInput): Promise<unknown> {
        return this.execute(
            createGenerateResultPrompt(input),
            input.comparisonFacts ? comparisonExplanationJsonSchema : generateResultJsonSchema,
            input.images,
            input.signal,
            this.analysisExecution('standard'),
            {
                stage: 'generate_result',
                promptVersion: input.comparisonFacts
                    ? checkupVersions.explanation
                    : agentPromptCatalog.generateResult.version,
                videoFrameCount: input.videoEvidence?.frames.length ?? 0,
                ...codexPromptCacheContracts.generate_result,
                ...(input.comparisonFacts
                    ? { schemaVersion: 'comparison-explanation.schema.v1' }
                    : {}),
            },
            input.videoEvidence,
        )
    }

    /** 执行最终输出唯一允许的一次受限结构修复。 */
    repairResult(input: AgentOutputRepairInput): Promise<unknown> {
        return this.execute(
            createRepairResultPrompt(input),
            createRepairResultJsonSchema(input),
            [],
            input.generationInput.signal,
            this.analysisExecution('lowest'),
            {
                stage: 'repair_agent_output',
                promptVersion: agentPromptCatalog.repairResult.version,
                ...codexPromptCacheContracts.repair_agent_output,
            },
        )
    }

    private taskFormationExecution(profile: CodexReasoningProfile): CodexStageExecution {
        const model = this.options.taskFormationModel || this.options.model
        return { model, effort: resolveCodexReasoningEffort(model, profile) }
    }

    private analysisExecution(profile: CodexReasoningProfile): CodexStageExecution {
        return {
            model: this.options.model,
            effort: resolveCodexReasoningEffort(this.options.model, profile),
        }
    }

    /** 选择配置的 Codex 传输方式并执行一次结构化生成 */
    private async execute(
        prompt: string,
        outputSchema: Record<string, unknown>,
        images: AgentResultGenerationInput['images'],
        signal: AbortSignal,
        execution: CodexStageExecution,
        diagnosticContext: CodexRequestDiagnosticContext,
        videoEvidence?: AgentResultGenerationInput['videoEvidence'],
        webSearchQueries: readonly string[] = [],
        maxTotalTokens?: number,
    ) {
        const webSearch = webSearchQueries.length > 0
        const inputDiagnostics = createCodexRequestDiagnostics({
            ...diagnosticContext,
            model: execution.model,
            reasoningEffort: execution.effort,
            prompt,
            outputSchema,
            images,
            imageDetail: 'provider_default',
        })
        if (videoEvidence) {
            validateAgentVideoEvidenceForProvider(videoEvidence, images, 'codex')
        } else {
            validateAgentImagesForProvider(images, 'codex')
        }
        if (signal.aborted) {
            throw new AgentCancelledError('Codex CLI 调用已取消', signal.reason)
        }
        if (this.options.mode === 'remote') {
            try {
                return attachRequestDiagnostics(
                    await this.appServerRunner({
                        url: this.options.remoteUrl,
                        token: this.options.remoteToken,
                        model: execution.model,
                        effort: execution.effort,
                        prompt,
                        outputSchema,
                        images,
                        signal,
                        webSearch,
                        maxTotalTokens,
                    }),
                    inputDiagnostics,
                )
            } catch (error) {
                attachRequestDiagnostics(error, inputDiagnostics)
                throw error
            }
        }
        const directory = await mkdtemp(path.join(tmpdir(), 'teeho-codex-'))
        try {
            const schemaPath = path.join(directory, 'output.schema.json')
            await writeFile(schemaPath, JSON.stringify(outputSchema), 'utf8')
            const imagePaths: string[] = []
            for (const [index, image] of images.entries()) {
                const imagePath = path.join(
                    directory,
                    `image-${index + 1}${imageExtension(image.mediaType)}`,
                )
                await writeFile(imagePath, Buffer.from(image.content))
                imagePaths.push(imagePath)
            }

            const args = [
                'exec',
                '--ephemeral',
                '--ignore-user-config',
                '--ignore-rules',
                '--strict-config',
                '--skip-git-repo-check',
                '--disable',
                'shell_tool',
                '--disable',
                'apps',
                '--disable',
                'browser_use',
                '--disable',
                'browser_use_external',
                '--disable',
                'browser_use_full_cdp_access',
                '--disable',
                'in_app_browser',
                '--disable',
                'computer_use',
                '--disable',
                'image_generation',
                '--disable',
                'plugins',
                '--disable',
                'multi_agent',
                '--disable',
                'multi_agent_v2',
                '--disable',
                'code_mode_host',
                ...(webSearch ? ['--search'] : ['--disable', 'standalone_web_search']),
                '--sandbox',
                'read-only',
                '--model',
                execution.model,
                '--output-schema',
                schemaPath,
                '--json',
                '-C',
                directory,
                '-c',
                'approval_policy="never"',
                '-c',
                `model_reasoning_effort="${execution.effort}"`,
                '-c',
                `web_search="${webSearch ? 'live' : 'disabled'}"`,
                '-c',
                'mcp_servers={}',
                '-c',
                'shell_environment_policy.inherit="none"',
                '-c',
                `tools.web_search=${webSearch}`,
                ...imagePaths.flatMap((imagePath) => ['--image', imagePath]),
                '-',
            ]
            const result = await this.processRunner({
                executablePath: this.options.executablePath,
                args,
                cwd: directory,
                stdin: prompt,
                signal,
                onStdoutLine:
                    maxTotalTokens === undefined
                        ? undefined
                        : createCliUsageBudgetMonitor(maxTotalTokens),
            })
            if (result.exitCode !== 0) {
                throw classifyCodexFailure(result)
            }
            return attachRequestDiagnostics(
                parseCodexJsonLines(result.stdout, webSearchQueries, maxTotalTokens),
                inputDiagnostics,
            )
        } catch (error) {
            attachRequestDiagnostics(error, inputDiagnostics)
            throw error
        } finally {
            const expectedPrefix = path.join(tmpdir(), 'teeho-codex-')
            if (directory.startsWith(expectedPrefix)) {
                await rm(directory, { recursive: true, force: true })
            }
        }
    }
}
