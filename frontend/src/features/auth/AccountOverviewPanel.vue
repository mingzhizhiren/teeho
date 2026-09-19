<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/icons/AppIcon.vue'
import LanguageSwitcher from '@/components/LanguageSwitcher.vue'
import ThemeSwitcher from '@/components/ThemeSwitcher.vue'
import { getFrontendRuntime } from '@/edition/runtime'
import type { AccountNavigationItem, AccountSectionId } from './account-center.types'

defineProps<{
    navigationItems: readonly AccountNavigationItem[]
}>()

const emit = defineEmits<{
    select: [sectionId: AccountSectionId]
}>()

const runtime = getFrontendRuntime()
const { t } = useI18n()
</script>

<template>
    <section>
        <RouterLink to="/skill/devices" class="mb-4 block text-sm font-semibold text-brand">{{
            t('skillAuth.devices')
        }}</RouterLink>
        <p class="text-sm leading-6 text-muted">
            {{ t('account.sections.overview.description') }}
        </p>

        <div class="mt-5 grid gap-3 sm:grid-cols-2">
            <div
                class="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-line bg-surface-muted px-3"
            >
                <span class="text-sm font-medium text-ink">
                    {{ t('common.theme') }}
                </span>
                <ThemeSwitcher />
            </div>
            <div
                class="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-line bg-surface-muted px-3"
            >
                <span class="text-sm font-medium text-ink">
                    {{ t('common.language') }}
                </span>
                <LanguageSwitcher />
            </div>
        </div>

        <component :is="runtime.accountOverview" v-if="runtime.accountOverview" />

        <div class="mt-6 border-t border-line pt-5 md:hidden">
            <h4 class="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
                {{ t('account.navigationLabel') }}
            </h4>
            <div class="mt-3 grid gap-2">
                <button
                    v-for="item in navigationItems"
                    :key="item.id"
                    class="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-line bg-surface-muted px-4 py-3 text-left transition hover:border-brand/40 hover:bg-brand/5 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/35"
                    type="button"
                    @click="emit('select', item.id)"
                >
                    <span
                        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand"
                        aria-hidden="true"
                    >
                        <AppIcon :name="item.icon" />
                    </span>
                    <span class="min-w-0 flex-1">
                        <span class="block font-semibold text-ink">{{ item.title }}</span>
                        <span class="mt-0.5 block text-xs leading-5 text-muted">
                            {{ item.description }}
                        </span>
                    </span>
                    <AppIcon class="shrink-0 text-muted" name="arrow-right" size="sm" />
                </button>
            </div>
        </div>
    </section>
</template>
