<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/icons/AppIcon.vue'
import type { AppIconName } from '@/components/icons/appIcon'
import { useTheme } from '@/composables/useTheme'
import type { AppTheme } from '@/utils/appConfig'

const { t } = useI18n()
const { theme, setTheme } = useTheme()
const themeOrder: AppTheme[] = ['system', 'light', 'dark']
const themeLabel = computed(() => `${t('common.theme')}：${t(`common.themes.${theme.value}`)}`)
const themeIcon = computed<AppIconName>(() => {
    if (theme.value === 'light') return 'sun'
    if (theme.value === 'dark') return 'moon'
    return 'monitor'
})

/** 切换到下一个可用主题 */
function selectNextTheme() {
    const currentIndex = themeOrder.indexOf(theme.value)
    setTheme(themeOrder[(currentIndex + 1) % themeOrder.length] ?? 'system')
}
</script>

<template>
    <button
        class="app-button app-button--secondary app-button--icon-only app-button--sm "
        type="button"
        :aria-label="themeLabel"
        :title="themeLabel"
        @click="selectNextTheme"
    >
        <AppIcon :name="themeIcon" size="sm" />
    </button>
</template>
