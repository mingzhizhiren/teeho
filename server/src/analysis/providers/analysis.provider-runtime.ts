import { TIME_MS } from '../../config/constants'
import { env, type Environment } from '../../config/env'
import {
    type AnalysisProviders,
    type WebResearchProvider,
} from '../research/analysis.research-provider'
import type { AgentUsageCallStage } from '../usage/analysis.agent-usage.contract'
import { CodexCliAgentProvider } from './analysis.codex-cli-provider'
import { MastraModelAgentProvider } from './analysis.mastra-provider'
import { MockAgentProvider } from './analysis.mock-provider'
import type { AgentProvider } from './analysis.provider'
import { createGuardedProviders } from './analysis.provider-guard'

interface AgentProviderSharedConfig {
    callTimeoutMs: number
    maxConcurrency: number
}

/** v0.1.0 进程内不可变的 Mock Provider 配置 */
export interface MockAgentProviderConfig extends AgentProviderSharedConfig {
    kind: 'mock'
    model: null
    taskFormationModel: null
}

/** Codex CLI Provider 配置；远程模式仍由同一个 Provider 实现。 */
export type CodexCliAgentProviderConfig = AgentProviderSharedConfig & {
    kind: 'codex-cli'
    model: string
    taskFormationModel: string
    executablePath: string
} & (
        | {
              mode: 'local'
          }
        | {
              mode: 'remote'
              remoteUrl: string
              remoteToken: string
          }
    )

/** Mastra Model Provider 配置 */
export interface MastraAgentProviderConfig extends AgentProviderSharedConfig {
    kind: 'openai' | 'gemini'
    model: string
    apiKey: string
}

/** 当前可由 Factory 创建的 Provider 配置 */
export type AgentProviderConfigSnapshot = Readonly<
    MockAgentProviderConfig | CodexCliAgentProviderConfig | MastraAgentProviderConfig
>

/** 测试可替换传输适配器；生产默认使用真实 Codex CLI 或 Mastra 实现。 */
export interface AgentProviderFactoryAdapters {
    createCodexCliProvider?: (
        config: Readonly<CodexCliAgentProviderConfig>,
    ) => AgentProvider & Partial<WebResearchProvider>
    createMastraModelProvider?: (config: Readonly<MastraAgentProviderConfig>) => AgentProvider
}

/** 进程内内容决策与可选资料搜集接口。 */
export type AgentProviderRuntime = AnalysisProviders

/** 从已经校验的进程环境生成不可变 Provider 配置快照 */
export function createAgentProviderConfigSnapshot(
    environment: Environment,
): AgentProviderConfigSnapshot {
    const sharedConfig = {
        callTimeoutMs: environment.TEEHO_AGENT_TIMEOUT_SECONDS * TIME_MS.SECOND,
        maxConcurrency: environment.TEEHO_AGENT_MAX_CONCURRENCY,
    }

    switch (environment.TEEHO_AGENT_PROVIDER) {
        case 'mock':
            return Object.freeze({
                kind: 'mock',
                model: null,
                taskFormationModel: null,
                ...sharedConfig,
            })
        case 'codex-cli':
            return environment.TEEHO_CODEX_MODE === 'remote'
                ? Object.freeze({
                      kind: 'codex-cli',
                      mode: 'remote',
                      model: environment.TEEHO_AGENT_MODEL,
                      taskFormationModel:
                          environment.TEEHO_TASK_FORMATION_AGENT_MODEL ||
                          environment.TEEHO_AGENT_MODEL,
                      executablePath: environment.TEEHO_CODEX_CLI_PATH,
                      remoteUrl: environment.TEEHO_CODEX_REMOTE_URL,
                      remoteToken: environment.TEEHO_CODEX_REMOTE_TOKEN,
                      ...sharedConfig,
                  })
                : Object.freeze({
                      kind: 'codex-cli',
                      mode: 'local',
                      model: environment.TEEHO_AGENT_MODEL,
                      taskFormationModel:
                          environment.TEEHO_TASK_FORMATION_AGENT_MODEL ||
                          environment.TEEHO_AGENT_MODEL,
                      executablePath: environment.TEEHO_CODEX_CLI_PATH,
                      ...sharedConfig,
                  })
        case 'openai':
            return Object.freeze({
                kind: 'openai',
                model: environment.TEEHO_AGENT_MODEL,
                apiKey: environment.OPENAI_API_KEY,
                ...sharedConfig,
            })
        case 'gemini':
            return Object.freeze({
                kind: 'gemini',
                model: environment.TEEHO_AGENT_MODEL,
                apiKey: environment.GEMINI_API_KEY,
                ...sharedConfig,
            })
    }
}

/** 根据不可变配置快照创建内容决策与可选资料搜集运行时。 */
export function createAgentProviderRuntime(
    config: AgentProviderConfigSnapshot,
    adapters: AgentProviderFactoryAdapters = {},
): AgentProviderRuntime {
    let provider: AgentProvider & Partial<WebResearchProvider>
    switch (config.kind) {
        case 'mock':
            provider = new MockAgentProvider()
            break
        case 'codex-cli':
            provider =
                adapters.createCodexCliProvider?.(config) ??
                new CodexCliAgentProvider(
                    config.mode === 'remote'
                        ? {
                              mode: 'remote',
                              executablePath: config.executablePath,
                              model: config.model,
                              taskFormationModel: config.taskFormationModel,
                              remoteUrl: config.remoteUrl,
                              remoteToken: config.remoteToken,
                          }
                        : {
                              mode: 'local',
                              executablePath: config.executablePath,
                              model: config.model,
                              taskFormationModel: config.taskFormationModel,
                          },
                )
            break
        case 'openai':
        case 'gemini':
            provider =
                adapters.createMastraModelProvider?.(config) ??
                new MastraModelAgentProvider({
                    provider: config.kind,
                    model: config.model,
                    apiKey: config.apiKey,
                })
            break
    }
    return createGuardedProviders(provider, null, config.callTimeoutMs, config.maxConcurrency)
}

const runtimeAgentProviderConfig = createAgentProviderConfigSnapshot(env)
let runtimeAgentProvider: AgentProviderRuntime | undefined

function getRuntimeProviders(): AgentProviderRuntime {
    runtimeAgentProvider ??= createAgentProviderRuntime(runtimeAgentProviderConfig)
    return runtimeAgentProvider
}

/** 返回进程启动时创建的 Agent Provider；运行期间不热切换 */
export function getRuntimeAgentProvider(): AgentProvider {
    return getRuntimeProviders().agent
}

/** 返回进程启动时创建的可选资料搜集接口。 */
export function getRuntimeWebResearchProvider(): WebResearchProvider | null {
    return getRuntimeProviders().webResearch
}

const taskFormationStages = new Set<AgentUsageCallStage>(['form_conversation_turn'])

/** 返回某一实际调用阶段将使用的 Provider 与模型。 */
export function getAgentProviderDescriptor(
    config: AgentProviderConfigSnapshot,
    stage: AgentUsageCallStage,
) {
    return {
        provider: config.kind,
        model:
            config.kind === 'codex-cli' && taskFormationStages.has(stage)
                ? config.taskFormationModel
                : config.model,
    } as const
}

/** worker 写入内部追溯所需的进程启动快照；永不进入公开 API。 */
export function getRuntimeAgentProviderDescriptor(stage: AgentUsageCallStage) {
    return getAgentProviderDescriptor(runtimeAgentProviderConfig, stage)
}

/** 返回两个冻结模型，供启动诊断使用，不进入公开 API。 */
export function getRuntimeAgentProviderModels() {
    return {
        analysis: runtimeAgentProviderConfig.model,
        taskFormation:
            runtimeAgentProviderConfig.kind === 'codex-cli'
                ? runtimeAgentProviderConfig.taskFormationModel
                : runtimeAgentProviderConfig.model,
    } as const
}
