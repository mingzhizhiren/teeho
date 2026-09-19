import { describe, expect, test } from 'vitest'
import { fileURLToPath } from 'node:url'
import configuration from '../../../plugins/example/config'
import { communityTaskFixture } from '../test/community-task.fixture'
import { createPluginRuntime, PluginError } from './runtime'
import { loadPluginRuntime } from './loader'

describe('community example plugin contract', () => {
    test('只用公开配置与合成 JSON 就能计算六维和展示项，输入保持不变', async () => {
        const runtime = await loadPluginRuntime(
            fileURLToPath(new URL('../../../plugins/example/config.ts', import.meta.url)),
        )
        const task = communityTaskFixture()
        const original = JSON.stringify(task)
        const signal = new AbortController().signal
        const evidence = await runtime.dataSource.load({
            task,
            signal,
            inputFingerprint: 'a'.repeat(64),
            asOf: '2026-09-13T00:00:00.000Z',
        })
        expect(evidence.notes.length).toBeGreaterThan(0)
        const result = await runtime.evaluate(evidence, task, signal)
        expect(Object.keys(result.radar)).toHaveLength(6)
        expect(
            Object.values(result.radar).every(
                (score) => score !== null && score >= 0 && score <= 10,
            ),
        ).toBe(true)
        expect(result.customMetrics[0]?.name).toBe('示例收藏增长')
        expect(JSON.stringify(task)).toBe(original)
        expect(runtime.version).toMatch(/^[a-f0-9]{64}$/u)
    })

    test('重复插件身份与未安装算法在装配时拒绝', () => {
        expect(() =>
            createPluginRuntime({
                ...configuration,
                plugins: [...configuration.plugins, ...configuration.plugins],
            }),
        ).toThrow(PluginError)
        expect(() =>
            createPluginRuntime({
                ...configuration,
                algorithms: {
                    ...configuration.algorithms,
                    titleExpression: 'example/not-installed',
                },
            }),
        ).toThrow(PluginError)
    })

    test('数据源错误只返回安全类别，不透传内部异常', async () => {
        const runtime = createPluginRuntime({
            ...configuration,
            dataSource: {
                load: async () => {
                    throw new Error('synthetic-internal-provider-details')
                },
            },
        })
        const input = {
            task: communityTaskFixture(),
            signal: new AbortController().signal,
            inputFingerprint: 'b'.repeat(64),
        }
        await expect(runtime.dataSource.load(input)).rejects.toBeInstanceOf(PluginError)
        await expect(runtime.dataSource.load(input)).rejects.not.toThrow(
            'synthetic-internal-provider-details',
        )
    })
})
