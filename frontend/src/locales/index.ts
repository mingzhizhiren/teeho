import { createI18n } from 'vue-i18n'
import enUs from '@/locales/en-US'
import zhCn from '@/locales/zh-CN'
import { appLocaleSchema, getAppConfig, updateAppConfig, type AppLocale } from '@/utils/appConfig'

const initialLocale = getAppConfig().locale

/** 创建指定语言的题火 i18n 实例。 */
export function createAppI18n(locale: AppLocale) {
    return createI18n({
        legacy: false,
        locale,
        fallbackLocale: 'en-US',
        messages: {
            'zh-CN': zhCn,
            'en-US': enUs,
        },
    })
}

/** Vue I18n 实例；界面默认中文，缺少翻译时回退到英文 */
export const i18n = createAppI18n(initialLocale)

/** 切换界面语言并持久化用户选择 */
export function setLocale(locale: AppLocale) {
    const validLocale = appLocaleSchema.parse(locale)
    i18n.global.locale.value = validLocale
    if (typeof document !== 'undefined') {
        document.documentElement.lang = validLocale
    }
    updateAppConfig({ locale: validLocale })
}

if (typeof document !== 'undefined') {
    document.documentElement.lang = initialLocale
}
