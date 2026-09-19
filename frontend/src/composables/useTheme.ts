import { readonly, ref } from 'vue'
import { getAppConfig, updateAppConfig, type AppTheme } from '@/utils/appConfig'

type EffectiveTheme = Exclude<AppTheme, 'system'>

const theme = ref<AppTheme>(getAppConfig().theme)
const effectiveTheme = ref<EffectiveTheme>('light')
let colorSchemeQuery: MediaQueryList | null = null
let initialized = false

function getColorSchemeQuery() {
    if (typeof window === 'undefined') return null
    colorSchemeQuery ??= window.matchMedia('(prefers-color-scheme: dark)')
    return colorSchemeQuery
}

/** 把系统主题设置解析为实际明暗主题 */
function resolveTheme(value: AppTheme): EffectiveTheme {
    if (value === 'system') {
        return getColorSchemeQuery()?.matches ? 'dark' : 'light'
    }

    return value
}

/** 把主题状态应用到页面根元素 */
function applyTheme(value: AppTheme) {
    const resolvedTheme = resolveTheme(value)
    effectiveTheme.value = resolvedTheme
    if (typeof document === 'undefined') return
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark')
    document.documentElement.style.colorScheme = resolvedTheme
}

/** 在应用挂载前应用本地主题，并监听系统主题变化 */
export function initializeTheme() {
    if (initialized || typeof window === 'undefined') return

    initialized = true
    applyTheme(theme.value)
    getColorSchemeQuery()?.addEventListener('change', () => {
        if (theme.value === 'system') {
            applyTheme('system')
        }
    })
}

/** 全局主题状态与持久化切换方法 */
export function useTheme() {
    /** 保存并应用用户选择的主题 */
    function setTheme(value: AppTheme) {
        const nextConfig = updateAppConfig({ theme: value })
        theme.value = nextConfig.theme
        applyTheme(nextConfig.theme)
    }

    return {
        theme: readonly(theme),
        effectiveTheme: readonly(effectiveTheme),
        setTheme,
    }
}
