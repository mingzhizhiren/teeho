import type { Agent } from '@mastra/core/agent'
import { z } from 'zod'
import { comparisonExplanationSchema } from '../checkup/analysis.comparison-explanation'
import {
    materialDescriptionSchema,
    materialPrompt,
    type MaterialUnderstandingInput,
} from '../materials/analysis.material'
import { materialClassificationProviderSchema } from '../materials/analysis.material.contract'

import { HTTP_STATUS } from '../../config/constants'
import { createContentDecisionAgent } from '../../mastra'
import {
    AgentCancelledError,
    AgentContractError,
    AgentProviderError,
    agentGeneratedResultProviderSchema,
    attachAgentProviderExecutionMetadata,
    validateAgentImagesForProvider,
    type AgentImageAsset,
    type AgentOutputRepairInput,
    type AgentProvider,
    type AgentResultGenerationInput,
} from './analysis.provider'
import { createGenerateResultPrompt, createRepairResultPrompt } from './analysis.provider-prompts'
import { normalizeAgentProviderUsage } from './analysis.provider-usage'

const maximumErrorTraversalDepth = 6

export interface MastraModelProviderOptions {
    provider: 'openai' | 'gemini'
    model: string
    apiKey: string
}

interface MastraGenerationInput {
    prompt: string
    images: AgentImageAsset[]
    schema: z.ZodType<unknown>
    signal: AbortSignal
    requestId: string
}

interface MastraGenerationOutput {
    object: unknown
    toolCalls: unknown[]
    executionId?: string | null
    usage?: unknown
}

export type MastraGenerationRunner = (
    input: MastraGenerationInput,
) => Promise<MastraGenerationOutput>

/** 把业务提示词和图片转换为模型消息 */
function createMessages(prompt: string, images: AgentImageAsset[]) {
    if (images.length === 0) {
        return prompt
    }
    return [
        {
            role: 'user' as const,
            content: [
                { type: 'text' as const, text: prompt },
                ...images.map((image) => ({
                    type: 'image' as const,
                    image: Buffer.from(image.content),
                    mimeType: image.mediaType,
                })),
            ],
        },
    ]
}

/** 创建绑定指定 Mastra 模型的生成执行器 */
function createAgentRunner(agent: Agent): MastraGenerationRunner {
    return async (input) => {
        const output = await agent.generate(createMessages(input.prompt, input.images), {
            structuredOutput: {
                // 两个业务 Schema 共享同一运行时协议；窄化只用于选择 Mastra 的重载。
                schema: input.schema as typeof agentGeneratedResultProviderSchema,
                errorStrategy: 'strict',
            },
            abortSignal: input.signal,
            activeTools: [],
            toolChoice: 'none',
            maxSteps: 1,
            runId: input.requestId,
            modelSettings: {
                maxRetries: 0,
            },
            disableBackgroundTasks: true,
        })
        return {
            object: output.object,
            toolCalls: output.toolCalls ?? [],
            executionId: input.requestId,
            usage: output.usage,
        }
    }
}

/** 从错误对象中读取 HTTP 状态码 */
function statusFromError(error: unknown) {
    if (typeof error !== 'object' || error === null) {
        return null
    }
    const candidate = error as { status?: unknown; statusCode?: unknown }
    const status = candidate.status ?? candidate.statusCode
    return typeof status === 'number' ? status : null
}

/** 从未知错误中读取错误名称 */
function errorName(error: unknown) {
    if (typeof error !== 'object' || error === null) {
        return typeof error
    }
    const name = (error as { name?: unknown }).name
    return typeof name === 'string' && name ? name : error.constructor?.name || 'Error'
}

/** 从未知错误中读取错误消息 */
function errorMessage(error: unknown) {
    if (error instanceof Error) {
        return error.message
    }
    if (typeof error === 'object' && error !== null) {
        const message = (error as { message?: unknown }).message
        if (typeof message === 'string') {
            return message
        }
    }
    return String(error)
}

/** 读取错误链中的下一级原始错误 */
function nextNestedError(error: unknown) {
    if (typeof error !== 'object' || error === null) {
        return null
    }
    const candidate = error as {
        cause?: unknown
        lastError?: unknown
        errors?: unknown
    }
    if (candidate.cause !== undefined) {
        return candidate.cause
    }
    if (candidate.lastError !== undefined) {
        return candidate.lastError
    }
    if (Array.isArray(candidate.errors) && candidate.errors.length > 0) {
        return candidate.errors[candidate.errors.length - 1]
    }
    return null
}

/** 从错误对象中读取允许记录的诊断字段 */
function readErrorDiagnosticField(error: unknown, key: string) {
    if (typeof error !== 'object' || error === null) {
        return undefined
    }
    return (error as Record<string, unknown>)[key]
}

/** 构造经过脱敏的 Mastra 调试信息 */
function createMastraDebugDetails(
    error: unknown,
    provider: MastraModelProviderOptions['provider'],
) {
    const errorChain: Array<Record<string, unknown>> = []
    const seen = new Set<unknown>()
    let current: unknown = error
    for (
        let depth = 0;
        depth < maximumErrorTraversalDepth && current !== null && !seen.has(current);
        depth += 1
    ) {
        seen.add(current)
        const diagnostic: Record<string, unknown> = {
            name: errorName(current),
            message: errorMessage(current),
            status: statusFromError(current),
        }
        for (const key of ['text', 'value', 'responseBody', 'issues', 'details'] as const) {
            const value = readErrorDiagnosticField(current, key)
            if (value !== undefined) {
                diagnostic[key] = value
            }
        }
        errorChain.push(diagnostic)
        current = nextNestedError(current)
    }
    return {
        provider,
        stage: 'mastra.generate',
        errorChain,
    }
}

/** 从结构校验错误中提取失败字段路径 */
function validationFieldPaths(error: unknown) {
    const paths = new Set<string>()
    const seen = new Set<unknown>()
    let current: unknown = error
    for (
        let depth = 0;
        depth < maximumErrorTraversalDepth && current !== null && !seen.has(current);
        depth += 1
    ) {
        seen.add(current)
        const issues = readErrorDiagnosticField(current, 'issues')
        if (Array.isArray(issues)) {
            for (const issue of issues) {
                if (typeof issue !== 'object' || issue === null) {
                    continue
                }
                const path = (issue as { path?: unknown }).path
                if (Array.isArray(path)) {
                    paths.add(path.map(String).join('.'))
                } else if (typeof path === 'string') {
                    paths.add(path)
                }
            }
        }
        current = nextNestedError(current)
    }
    return [...paths].filter(Boolean)
}

/** 汇总错误链文本以辅助稳定分类 */
function errorChainText(error: unknown) {
    const parts: string[] = []
    const seen = new Set<unknown>()
    let current: unknown = error
    for (
        let depth = 0;
        depth < maximumErrorTraversalDepth && current !== null && !seen.has(current);
        depth += 1
    ) {
        seen.add(current)
        const responseBody = readErrorDiagnosticField(current, 'responseBody')
        parts.push(
            `${errorName(current)} ${errorMessage(current)} ${
                typeof responseBody === 'string' ? responseBody : ''
            }`.toLocaleLowerCase(),
        )
        current = nextNestedError(current)
    }
    return parts.join('\n')
}

/** 沿错误链查找可用的 HTTP 状态码 */
function statusFromErrorChain(error: unknown) {
    const seen = new Set<unknown>()
    let current: unknown = error
    for (
        let depth = 0;
        depth < maximumErrorTraversalDepth && current !== null && !seen.has(current);
        depth += 1
    ) {
        seen.add(current)
        const status = statusFromError(current)
        if (status !== null) {
            return status
        }
        current = nextNestedError(current)
    }
    return null
}

/** 把 Mastra 调用异常归类为稳定的 Provider 错误 */
function classifyMastraError(
    error: unknown,
    signal: AbortSignal,
    provider: MastraModelProviderOptions['provider'],
) {
    if (error instanceof AgentProviderError) {
        return error
    }
    if (signal.aborted) {
        return new AgentCancelledError('Mastra 模型调用已取消', error)
    }

    const status = statusFromErrorChain(error)
    const message = errorChainText(error)
    const debugDetails = createMastraDebugDetails(error, provider)
    if (
        status === HTTP_STATUS.UNAUTHORIZED ||
        status === HTTP_STATUS.FORBIDDEN ||
        /api key|authentication|unauthori[sz]ed/u.test(message)
    ) {
        return new AgentProviderError('authentication', {
            message: '模型身份验证失败',
            retryable: false,
            cause: error,
            debugDetails,
        })
    }
    if (
        status === HTTP_STATUS.TOO_MANY_REQUESTS ||
        /rate.?limit|too many requests/u.test(message)
    ) {
        return new AgentProviderError('rate_limited', {
            message: '模型请求受到限流',
            retryable: true,
            cause: error,
            debugDetails,
        })
    }
    if (
        status === HTTP_STATUS.NOT_FOUND &&
        /model.+(?:not found|not supported)|not found.+generatecontent/u.test(message)
    ) {
        return new AgentProviderError('configuration', {
            message: '模型配置不存在或不支持当前调用',
            diagnosticMessage: '模型配置不存在或不支持当前调用',
            retryable: false,
            validationFieldPaths: ['model'],
            ruleId: 'mastra.model',
            cause: error,
            debugDetails,
        })
    }
    if (
        ((status === HTTP_STATUS.BAD_REQUEST || status === HTTP_STATUS.UNPROCESSABLE_CONTENT) &&
            /schema|response.?format|structured output/u.test(message)) ||
        /invalid schema for|schema.+(?:unsupported|not supported)|cannot be represented in json schema/u.test(
            message,
        )
    ) {
        return new AgentProviderError('configuration', {
            message: '模型结构化输出 Schema 配置无效',
            retryable: false,
            validationFieldPaths: ['structuredOutput.schema'],
            ruleId: 'mastra.structured-output-schema',
            cause: error,
            debugDetails,
        })
    }
    if (
        /typevalidationerror|jsonparseerror|noobjectgeneratederror/u.test(message) ||
        /structured output.+(?:validation|parse|invalid|failed)|invalid json|failed to parse.+json/u.test(
            message,
        )
    ) {
        const fieldPaths = validationFieldPaths(error)
        return new AgentContractError('模型结构化输出无效', {
            validationFieldPaths: fieldPaths.length ? fieldPaths : ['structuredOutput'],
            ruleId: 'mastra.structured-output',
            cause: error,
            debugDetails,
        })
    }
    if (/unsupported|does not support|capabilit|image input/u.test(message)) {
        return new AgentProviderError('capability', {
            message: '当前模型不支持任务能力',
            retryable: false,
            cause: error,
            debugDetails,
        })
    }
    if (
        (status !== null && status >= HTTP_STATUS.INTERNAL_SERVER_ERROR) ||
        /timeout|timed out|connection|network|temporar|unavailable/u.test(message)
    ) {
        return new AgentProviderError('temporary_unavailable', {
            message: '模型服务暂时不可用',
            retryable: true,
            cause: error,
            debugDetails,
        })
    }
    return new AgentProviderError('unknown', {
        message: '模型调用失败',
        retryable: false,
        cause: error,
        debugDetails,
    })
}

/**
 * OpenAI 与 Gemini 共用的 Mastra Provider。
 * 两种模型和 Codex CLI、Mock 均只实现相同的两个业务方法。
 */
export class MastraModelAgentProvider implements AgentProvider {
    private readonly runner: MastraGenerationRunner
    private readonly provider: MastraModelProviderOptions['provider']

    /**
     * 创建通过 Mastra 模型适配层执行生成任务的 Provider。
     * @param options 模型供应商、模型名称及连接配置
     * @param runner 可替换的模型生成执行器
     */
    constructor(options: MastraModelProviderOptions, runner?: MastraGenerationRunner) {
        this.provider = options.provider
        this.runner =
            runner ??
            createAgentRunner(
                createContentDecisionAgent({
                    provider: options.provider,
                    model: options.model,
                    apiKey: options.apiKey,
                }),
            )
    }

    understandMaterial(input: MaterialUnderstandingInput): Promise<unknown> {
        return this.generate({
            prompt: materialPrompt(input),
            images: input.images,
            schema:
                input.kind === 'classification'
                    ? materialClassificationProviderSchema
                    : materialDescriptionSchema,
            signal: input.signal,
            requestId: input.correlation.requestId,
        })
    }

    generateResult(input: AgentResultGenerationInput): Promise<unknown> {
        return this.generate({
            prompt: createGenerateResultPrompt(input),
            images: input.images,
            schema: input.comparisonFacts
                ? comparisonExplanationSchema
                : agentGeneratedResultProviderSchema,
            signal: input.signal,
            requestId: input.correlation.requestId,
        })
    }

    /** 执行最终输出唯一允许的一次受限结构修复。 */
    repairResult(input: AgentOutputRepairInput): Promise<unknown> {
        return this.generate({
            prompt: createRepairResultPrompt(input),
            images: [],
            schema: z
                .object({
                    repairPatch:
                        input.mode === 'full'
                            ? agentGeneratedResultProviderSchema
                            : z.record(z.unknown()),
                })
                .strict(),
            signal: input.generationInput.signal,
            requestId: input.generationInput.correlation.requestId,
        })
    }

    private async generate(input: MastraGenerationInput) {
        validateAgentImagesForProvider(input.images, this.provider)
        try {
            const output = await this.runner(input)
            if (output.toolCalls.length > 0) {
                throw new AgentContractError('Mastra Agent 不得调用工具', {
                    validationFieldPaths: ['toolCalls'],
                    ruleId: 'mastra.no-tools',
                })
            }
            return attachAgentProviderExecutionMetadata(output.object, {
                executionId: output.executionId ?? input.requestId,
                usage: normalizeAgentProviderUsage(output.usage),
            })
        } catch (error) {
            throw classifyMastraError(error, input.signal, this.provider)
        }
    }
}
