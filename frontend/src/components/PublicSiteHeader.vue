<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import BrandMark from '@/components/BrandMark.vue'
import LanguageSwitcher from '@/components/LanguageSwitcher.vue'
import ThemeSwitcher from '@/components/ThemeSwitcher.vue'
const { t } = useI18n()
</script>

<template>
    <header class="border-b border-line bg-canvas">
        <nav
            class="mx-auto flex min-h-20 max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-8"
            :aria-label="t('common.navigation')"
        >
            <RouterLink to="/"><BrandMark /></RouterLink>
            <div class="flex items-center gap-3">
                <RouterLink class="text-sm font-semibold text-brand" to="/workspace">{{
                    t('pages.workspace')
                }}</RouterLink>
                <RouterLink class="text-sm font-semibold text-brand" to="/skill">{{
                    t('skillInstall.title')
                }}</RouterLink>
                <ThemeSwitcher />
                <LanguageSwitcher />
            </div>
        </nav>
    </header>
</template>
