import type { logger } from '../../utils/logger'
import {
    AgentCancelledError,
    AgentProviderError,
    attachAgentProviderExecutionMetadata,
    isAgentServiceUnavailable,
    readAgentProviderExecutionMetadata,
    type AgentProvider,
    type AgentProviderExecutionMetadata,
    type AgentResultGenerationInput,
} from '../providers/analysis.provider'
import type {
    AgentUsageCallService,
    AgentUsageProviderDescriptor,
} from '../usage/analysis.agent-usage.service'
import { checkupVersions } from './analysis.checkup.constants'
import {
    advicePayload,
    ContentAdviceValidationError,
    readContentAdvice,
    unavailableContentAdvice,
} from './analysis.advice'
import {
    fallbackContentExplanation,
    readContentExplanation,
} from './analysis.comparison-explanation'
import { contentScoreMultiplier } from './analysis.content-analysis'

const MAX_REVIEW_ATTEMPTS = 2
type CoreExplanation = ReturnType<typeof readContentExplanation>
type FailureReason = ContentAdviceValidationError['reason'] | 'provider' | 'core_fallback'
interface RetainedCore {
    value: CoreExplanation
    metadata: AgentProviderExecutionMetadata | null
}
interface ContentReviewInput {
    userId: string
    taskId: string
    requestId: string
    signal: AbortSignal
    generation: AgentResultGenerationInput
    agent: {
        provider: AgentProvider
        descriptor: AgentUsageProviderDescriptor
        usage: AgentUsageCallService
    }
    log: Pick<typeof logger, 'debug' | 'warn'>
}

async function invoke(input: ContentReviewInput, adviceRetry: boolean): Promise<unknown> {
    input.signal.throwIfAborted()
    try {
        const result = await input.agent.provider.generateResult(input.generation)
        input.signal.throwIfAborted()
        return result
    } catch (error) {
        if (input.signal.aborted || error instanceof AgentCancelledError) throw error
        if (!adviceRetry) {
            if (error instanceof AgentProviderError) throw error
            throw new AgentProviderError('capability', { cause: error })
        }
        // 独立建议失败只保留安全类别和用量，不能把模型原文带进新增降级日志。
        const safe = new AgentProviderError(
            error instanceof AgentProviderError ? error.category : 'capability',
            { message: '优化建议生成失败', retryable: false },
        )
        const metadata = readAgentProviderExecutionMetadata(error)
        if (metadata) attachAgentProviderExecutionMetadata(safe, metadata)
        throw safe
    }
}

/** 回答是否重试恢复、何因降级、是否保持首次有效核心及评分倍率。 */
function finish(
    input: ContentReviewInput,
    retained: RetainedCore,
    attempts: number,
    outcome: 'completed' | 'recovered' | 'unavailable',
    reason: FailureReason | null,
    corePreserved: boolean,
): RetainedCore {
    input.signal.throwIfAborted()
    const fields = {
        event: 'analysis_advice_review',
        requestId: input.requestId,
        taskId: input.taskId,
        attempts,
        outcome,
        reason,
        corePreserved,
        consistencyStars: retained.value.consistency.stars,
        scoreMultiplier: contentScoreMultiplier({
            ...retained.value,
            scorePolicy: 'consistency-weighted.v2',
        }),
        itemCount: retained.value.advice?.items.length ?? 0,
    }
    if (outcome === 'completed') input.log.debug(fields, '优化建议完成')
    else input.log.warn(fields, '优化建议独立重试或降级完成')
    return retained
}

function fallback(
    input: ContentReviewInput,
    error: AgentProviderError,
    attempts: number,
): RetainedCore {
    if (isAgentServiceUnavailable(error)) throw error
    input.log.warn(
        {
            event: 'analysis_content_review_fallback',
            taskId: input.taskId,
            requestId: input.requestId,
            errorCategory: error.category,
        },
        '内容分析失败，使用默认三星',
    )
    return finish(
        input,
        {
            value: {
                ...fallbackContentExplanation(input.generation),
                advice: unavailableContentAdvice(),
            },
            metadata: null,
        },
        attempts,
        'unavailable',
        'core_fallback',
        false,
    )
}

/** 共享两次生成预算；第一份有效核心被冻结，后续仅替换独立建议。 */
export async function reviewAnalysisContent(input: ContentReviewInput): Promise<RetainedCore> {
    input.signal.throwIfAborted()
    let retained: RetainedCore | null = null
    let reason: FailureReason | null = null
    const currentCore = (): RetainedCore | null => retained
    for (let attempt = 1; attempt <= MAX_REVIEW_ATTEMPTS; attempt += 1) {
        const adviceRetry = currentCore() !== null
        try {
            const tracked = await input.agent.usage.execute({
                userId: input.userId,
                association: { kind: 'task', id: input.taskId },
                requestId: input.requestId,
                stage: 'generate_result',
                provider: input.agent.descriptor,
                promptVersion: checkupVersions.explanation,
                attemptNumber: attempt,
                media: { imageInputCount: 0, videoFrameInputCount: 0 },
                invoke: () => invoke(input, adviceRetry),
                parse: (raw: unknown) => {
                    const core = currentCore() ?? {
                        value: readContentExplanation(input.generation, raw),
                        metadata: readAgentProviderExecutionMetadata(raw),
                    }
                    retained = core
                    return {
                        ...core.value,
                        advice: readContentAdvice(input.generation, advicePayload(raw)),
                    }
                },
                shouldRetry: (error) =>
                    attempt < MAX_REVIEW_ATTEMPTS &&
                    error instanceof AgentProviderError &&
                    error.retryable,
            })
            return finish(
                input,
                { ...tracked, metadata: currentCore()!.metadata },
                attempt,
                adviceRetry ? 'recovered' : 'completed',
                reason,
                adviceRetry,
            )
        } catch (error) {
            if (
                input.signal.aborted ||
                error instanceof AgentCancelledError ||
                !(error instanceof AgentProviderError)
            )
                throw error
            reason = error instanceof ContentAdviceValidationError ? error.reason : 'provider'
            const core = currentCore()
            if (core && attempt === MAX_REVIEW_ATTEMPTS) {
                return finish(
                    input,
                    { ...core, value: { ...core.value, advice: unavailableContentAdvice() } },
                    attempt,
                    'unavailable',
                    reason,
                    true,
                )
            }
            if (!core && (attempt === MAX_REVIEW_ATTEMPTS || !error.retryable))
                return fallback(input, error, attempt)
            if (core)
                input.log.warn(
                    {
                        event: 'analysis_advice_retry',
                        requestId: input.requestId,
                        taskId: input.taskId,
                        reason,
                        attempt,
                        corePreserved: true,
                    },
                    '优化建议校验失败，保留核心并重试',
                )
        }
    }
    throw new Error('Content review exhausted its bounded attempts')
}
