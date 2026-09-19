import { describe, expect, it, vi } from 'vitest'

import { parseEnvironment } from '../../config/env'
import type { AgentProvider } from './analysis.provider'
import {
    createAgentProviderConfigSnapshot,
    createAgentProviderRuntime,
    getAgentProviderDescriptor,
} from './analysis.provider-runtime'

const baseEnvironment = {
    NODE_ENV: 'test',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
    DATABASE_DIRECT_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    TEEHO_PWD: 'provider-runtime-test-secret',
}

describe('Agent Provider runtime', () => {
    it('启动配置生成不可变 Mock 快照并由 Factory 创建统一 Provider', () => {
        const environment = parseEnvironment({
            ...baseEnvironment,
            TEEHO_AGENT_PROVIDER: 'mock',
            TEEHO_AGENT_MODEL: '',
        })

        const snapshot = createAgentProviderConfigSnapshot(environment)

        expect(snapshot).toEqual({
            kind: 'mock',
            model: null,
            taskFormationModel: null,
            callTimeoutMs: 180_000,
            maxConcurrency: 1,
        })
        expect(Object.isFrozen(snapshot)).toBe(true)
        const runtime = createAgentProviderRuntime(snapshot)
        expect(runtime.agent.constructor.name).toBe('GuardedAgentProvider')
        expect(runtime.webResearch).toBeNull()
    })

    it.each([
        {
            kind: 'codex-cli' as const,
            environment: {
                TEEHO_AGENT_PROVIDER: 'codex-cli',
                TEEHO_AGENT_MODEL: 'codex-test-model',
                TEEHO_TASK_FORMATION_AGENT_MODEL: 'codex-task-model',
                TEEHO_CODEX_MODE: 'local',
                TEEHO_CODEX_CLI_PATH: 'codex-test',
            },
            expected: {
                kind: 'codex-cli',
                mode: 'local',
                model: 'codex-test-model',
                taskFormationModel: 'codex-task-model',
                executablePath: 'codex-test',
            },
            adapter: 'codex',
        },
        {
            kind: 'openai' as const,
            environment: {
                TEEHO_AGENT_PROVIDER: 'openai',
                TEEHO_AGENT_MODEL: 'openai-test-model',
                OPENAI_API_KEY: 'openai-test-key',
            },
            expected: {
                kind: 'openai',
                model: 'openai-test-model',
                apiKey: 'openai-test-key',
            },
            adapter: 'mastra',
        },
        {
            kind: 'gemini' as const,
            environment: {
                TEEHO_AGENT_PROVIDER: 'gemini',
                TEEHO_AGENT_MODEL: 'gemini-test-model',
                GEMINI_API_KEY: 'gemini-test-key',
            },
            expected: {
                kind: 'gemini',
                model: 'gemini-test-model',
                apiKey: 'gemini-test-key',
            },
            adapter: 'mastra',
        },
    ])('$kind 使用显式模型配置且 Factory 不执行探测', ({ environment, expected, adapter }) => {
        const provider: AgentProvider = {
            generateResult: vi.fn(),
        }
        const createCodexCliProvider = vi.fn(() => provider)
        const createMastraModelProvider = vi.fn(() => provider)
        const snapshot = createAgentProviderConfigSnapshot(
            parseEnvironment({
                ...baseEnvironment,
                ...environment,
            }),
        )

        const created = createAgentProviderRuntime(snapshot, {
            createCodexCliProvider,
            createMastraModelProvider,
        })

        expect(snapshot).toMatchObject({
            ...expected,
            callTimeoutMs: 180_000,
            maxConcurrency: 1,
        })
        expect(Object.isFrozen(snapshot)).toBe(true)
        expect(created.agent.constructor.name).toBe('GuardedAgentProvider')
        expect(created.webResearch).toBeNull()
        expect(provider.generateResult).not.toHaveBeenCalled()
        expect(
            adapter === 'codex' ? createCodexCliProvider : createMastraModelProvider,
        ).toHaveBeenCalledOnce()
    })

    it('Codex remote 配置仍由同一个 Factory 和 Provider kind 创建', () => {
        const provider: AgentProvider = {
            generateResult: vi.fn(),
        }
        const createCodexCliProvider = vi.fn(() => provider)
        const snapshot = createAgentProviderConfigSnapshot(
            parseEnvironment({
                ...baseEnvironment,
                TEEHO_AGENT_PROVIDER: 'codex-cli',
                TEEHO_AGENT_MODEL: 'codex-test-model',
                TEEHO_TASK_FORMATION_AGENT_MODEL: 'codex-task-model',
                TEEHO_CODEX_MODE: 'remote',
                TEEHO_CODEX_REMOTE_URL: 'wss://codex.example.com/app-server',
                TEEHO_CODEX_REMOTE_TOKEN: 'remote-test-token',
            }),
        )

        createAgentProviderRuntime(snapshot, { createCodexCliProvider })

        expect(snapshot).toMatchObject({
            kind: 'codex-cli',
            mode: 'remote',
            model: 'codex-test-model',
            taskFormationModel: 'codex-task-model',
            remoteUrl: 'wss://codex.example.com/app-server',
            remoteToken: 'remote-test-token',
        })
        expect(createCodexCliProvider).toHaveBeenCalledWith(snapshot)
    })

    it('正式运行时停用联网研究，即使适配器仍提供离线评估接口', () => {
        const provider = {
            generateResult: vi.fn(),
            collect: vi.fn(),
        }
        const snapshot = createAgentProviderConfigSnapshot(
            parseEnvironment({
                ...baseEnvironment,
                TEEHO_AGENT_PROVIDER: 'codex-cli',
                TEEHO_AGENT_MODEL: 'codex-test-model',
                TEEHO_CODEX_MODE: 'local',
                TEEHO_CODEX_CLI_PATH: 'codex-test',
            }),
        )

        const runtime = createAgentProviderRuntime(snapshot, {
            createCodexCliProvider: () => provider,
        })

        expect(runtime.agent.constructor.name).toBe('GuardedAgentProvider')
        expect(runtime.webResearch).toBeNull()
    })

    it('任务形成模型为空时在启动快照中静态使用主模型，并按阶段返回实际描述', () => {
        const snapshot = createAgentProviderConfigSnapshot(
            parseEnvironment({
                ...baseEnvironment,
                TEEHO_AGENT_PROVIDER: 'codex-cli',
                TEEHO_AGENT_MODEL: 'codex-main-model',
                TEEHO_TASK_FORMATION_AGENT_MODEL: '',
            }),
        )

        expect(snapshot).toMatchObject({
            model: 'codex-main-model',
            taskFormationModel: 'codex-main-model',
        })
        expect(getAgentProviderDescriptor(snapshot, 'form_conversation_turn')).toEqual({
            provider: 'codex-cli',
            model: 'codex-main-model',
        })
        expect(getAgentProviderDescriptor(snapshot, 'generate_result')).toEqual({
            provider: 'codex-cli',
            model: 'codex-main-model',
        })
    })

    it('Codex 双模型描述在任务受理边界前后保持准确', () => {
        const snapshot = createAgentProviderConfigSnapshot(
            parseEnvironment({
                ...baseEnvironment,
                TEEHO_AGENT_PROVIDER: 'codex-cli',
                TEEHO_AGENT_MODEL: 'codex-main-model',
                TEEHO_TASK_FORMATION_AGENT_MODEL: 'gpt-5.3-codex-spark',
            }),
        )

        for (const stage of ['form_conversation_turn'] as const) {
            expect(getAgentProviderDescriptor(snapshot, stage)).toEqual({
                provider: 'codex-cli',
                model: 'gpt-5.3-codex-spark',
            })
        }
        for (const stage of [
            'collect_web_research',
            'generate_result',
            'repair_agent_output',
        ] as const) {
            expect(getAgentProviderDescriptor(snapshot, stage)).toEqual({
                provider: 'codex-cli',
                model: 'codex-main-model',
            })
        }
    })

    it.each([
        {
            name: '非法 Provider',
            environment: { TEEHO_AGENT_PROVIDER: 'unknown' },
        },
        {
            name: '真实 Provider 未锁定模型',
            environment: {
                TEEHO_AGENT_PROVIDER: 'codex-cli',
                TEEHO_AGENT_MODEL: '',
            },
        },
        {
            name: 'Mock 错配模型',
            environment: {
                TEEHO_AGENT_PROVIDER: 'mock',
                TEEHO_AGENT_MODEL: 'should-not-be-used',
            },
        },
        {
            name: 'Mock 错配任务形成模型',
            environment: {
                TEEHO_AGENT_PROVIDER: 'mock',
                TEEHO_TASK_FORMATION_AGENT_MODEL: 'should-not-be-used',
            },
        },
        {
            name: 'OpenAI 缺少凭据',
            environment: {
                TEEHO_AGENT_PROVIDER: 'openai',
                TEEHO_AGENT_MODEL: 'openai-test-model',
            },
        },
        {
            name: 'Gemini 缺少凭据',
            environment: {
                TEEHO_AGENT_PROVIDER: 'gemini',
                TEEHO_AGENT_MODEL: 'gemini-test-model',
            },
        },
        {
            name: '调用超时不是正整数',
            environment: {
                TEEHO_AGENT_PROVIDER: 'mock',
                TEEHO_AGENT_TIMEOUT_SECONDS: '0',
            },
        },
        {
            name: '并发数不是正整数',
            environment: {
                TEEHO_AGENT_PROVIDER: 'mock',
                TEEHO_AGENT_MAX_CONCURRENCY: '0',
            },
        },
        {
            name: 'Codex remote 缺少地址和令牌',
            environment: {
                TEEHO_AGENT_PROVIDER: 'codex-cli',
                TEEHO_AGENT_MODEL: 'codex-test-model',
                TEEHO_CODEX_MODE: 'remote',
                TEEHO_CODEX_REMOTE_URL: '',
                TEEHO_CODEX_REMOTE_TOKEN: '',
            },
        },
        {
            name: 'Codex remote 地址协议非法',
            environment: {
                TEEHO_AGENT_PROVIDER: 'codex-cli',
                TEEHO_AGENT_MODEL: 'codex-test-model',
                TEEHO_CODEX_MODE: 'remote',
                TEEHO_CODEX_REMOTE_URL: 'https://codex.example.com',
                TEEHO_CODEX_REMOTE_TOKEN: 'remote-test-token',
            },
        },
        {
            name: '加密口令为空',
            environment: {
                TEEHO_PWD: '   ',
            },
        },
    ])('$name 时启动配置校验失败', ({ environment }) => {
        expect(() =>
            parseEnvironment({
                ...baseEnvironment,
                OPENAI_API_KEY: '',
                GEMINI_API_KEY: '',
                ...environment,
            }),
        ).toThrow()
    })
})
