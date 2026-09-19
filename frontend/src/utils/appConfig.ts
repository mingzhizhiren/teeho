import { z } from 'zod'
import { supportsLocalStorage } from '@/utils/browserFeatures'

const appConfigStorageKey = 'teeho.app-config.v1'

/** 应用支持的界面语言 */
export const appLocaleSchema = z.enum(['zh-CN', 'en-US'])

/** 应用支持的界面主题 */
export const appThemeSchema = z.enum(['light', 'dark', 'system'])

/** 工作台上次使用的公开输入模式 */
export const analysisInputModeSchema = z.enum(['agent', 'custom'])

const appConfigSchema = z.object({
    locale: appLocaleSchema,
    theme: appThemeSchema,
    analysisInputMode: analysisInputModeSchema,
})

const storedAppConfigSchema = appConfigSchema.partial()

export type AppLocale = z.infer<typeof appLocaleSchema>
export type AppTheme = z.infer<typeof appThemeSchema>
export type AnalysisInputMode = z.infer<typeof analysisInputModeSchema>
export type AppConfig = z.infer<typeof appConfigSchema>

/** 应用配置默认值；新增配置项时在此处提供默认值 */
export const defaultAppConfig: Readonly<AppConfig> = Object.freeze({
    locale: 'zh-CN',
    theme: 'system',
    analysisInputMode: 'agent',
})

/** 从 localStorage 读取配置，并用默认值补齐旧版本缺少的字段 */
export function getAppConfig(): AppConfig {
    if (!supportsLocalStorage()) {
        return { ...defaultAppConfig }
    }

    try {
        const storedValue = window.localStorage.getItem(appConfigStorageKey)
        if (!storedValue) {
            return { ...defaultAppConfig }
        }

        const parsedConfig = storedAppConfigSchema.safeParse(JSON.parse(storedValue) as unknown)
        if (!parsedConfig.success) {
            return { ...defaultAppConfig }
        }

        return appConfigSchema.parse({ ...defaultAppConfig, ...parsedConfig.data })
    } catch {
        return { ...defaultAppConfig }
    }
}

/** 更新并持久化部分应用配置，返回合并后的完整配置 */
export function updateAppConfig(config: Partial<AppConfig>): AppConfig {
    const nextConfig = appConfigSchema.parse({ ...getAppConfig(), ...config })

    if (supportsLocalStorage()) {
        try {
            window.localStorage.setItem(appConfigStorageKey, JSON.stringify(nextConfig))
        } catch {
            // 浏览器可能在能力检测后因隐私策略或容量限制拒绝写入，仍保留内存中的配置
        }
    }

    return nextConfig
}

/** 删除用户配置并恢复默认值 */
export function resetAppConfig(): AppConfig {
    if (supportsLocalStorage()) {
        try {
            window.localStorage.removeItem(appConfigStorageKey)
        } catch {
            // 清理失败不影响调用方恢复默认值
        }
    }

    return { ...defaultAppConfig }
}
