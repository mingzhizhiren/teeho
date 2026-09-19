import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createPluginRuntime, PluginError } from './runtime'
import type { PluginConfiguration, PluginRuntime } from './contract'

/** 配置仅由受信任部署者提供；普通请求不能选择或加载模块。 */
export async function loadPluginRuntime(configPath: string): Promise<PluginRuntime> {
    if (!configPath.trim()) throw new PluginError('configuration', 'config_required')
    const moduleUrl = pathToFileURL(resolve(configPath)).href
    try {
        const module = await import(/* @vite-ignore */ moduleUrl)
        if (!module.default || typeof module.default !== 'object') throw new Error('invalid_config')
        return createPluginRuntime(module.default as PluginConfiguration)
    } catch (error) {
        if (error instanceof PluginError) throw error
        throw new PluginError('configuration', 'config_load_failed')
    }
}
