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
        class="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-surface text-muted transition hover:border-muted/60 hover:bg-surface-muted hover:text-ink focus:outline-none focus:ring-4 focus:ring-brand/10"
        type="button"
        :aria-label="themeLabel"
        :title="themeLabel"
        @click="selectNextTheme"
    >
        <AppIcon :name="themeIcon" size="sm" />
    </button>
</template>
