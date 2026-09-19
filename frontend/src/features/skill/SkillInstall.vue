<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ToastMessage from '@/components/ToastMessage.vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import { publicSite } from '@/config/publicSite'
import skillRelease from '@/config/skill-release.generated.json'
import SkillUsageExamples from './SkillUsageExamples.vue'
import SkillChatDemo from './SkillChatDemo.vue'

const { t } = useI18n()
const site = new URL(
    typeof window === 'undefined' ? publicSite.canonicalUrl : window.location.origin,
)
const origin =
    ['http:', 'https:'].includes(site.protocol) && /^[a-z\d.:[\]-]+$/i.test(site.hostname)
        ? site.origin
        : publicSite.canonicalUrl
const instructionUrl = `${origin}/skill-install.md`
const agentPrompt = computed(() =>
    t('skillInstall.agentPrompt', { url: instructionUrl, version: skillRelease.version }),
)
const copied = ref(false)
const copyError = ref(false)
const copying = ref(false)
let toastTimer: ReturnType<typeof setTimeout> | undefined
const COPY_NOTICE_MS = 2000
let disposed = false

async function copy(value: string): Promise<void> {
    if (copying.value) return
    copying.value = true
    copyError.value = false
    try {
        await navigator.clipboard.writeText(value)
        if (disposed) return
        copied.value = true
        clearTimeout(toastTimer)
        toastTimer = setTimeout(() => {
            copied.value = false
        }, COPY_NOTICE_MS)
    } catch {
        if (!disposed) copyError.value = true
    } finally {
        copying.value = false
    }
}
onBeforeUnmount(() => {
    disposed = true
    clearTimeout(toastTimer)
})
</script>

<template>
    <main class="flex-1 px-5 py-12 sm:px-8 sm:py-16 lg:px-10 lg:py-20">
        <div class="mx-auto max-w-5xl">
            <p class="text-sm font-semibold text-brand">{{ t('skillInstall.navLabel') }}</p>
            <h1 class="mt-4 text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
                {{ t('skillInstall.title') }}
            </h1>
            <p class="mt-5 max-w-3xl text-base leading-8 text-muted">
                {{ t('skillInstall.description') }}
            </p>
            <p class="mt-3 text-sm leading-6 text-muted">{{ t('skillInstall.compatibility') }}</p>

            <div class="mt-10 grid gap-6 md:grid-cols-2">
                <section
                    class="relative flex min-w-0 flex-col overflow-hidden rounded-3xl border border-brand/25 bg-surface p-6 sm:p-8"
                    data-testid="skill-agent-install"
                >
                    <div class="mb-6 flex items-center justify-between">
                        <span
                            class="grid size-12 place-items-center rounded-2xl bg-brand/10 text-brand"
                        >
                            <AppIcon name="robot" size="lg" />
                        </span>
                        <span
                            class="rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand"
                        >{{ t('skillInstall.agentMethod') }}</span
                        >
                    </div>
                    <h2 class="text-xl font-semibold text-ink">
                        {{ t('skillInstall.agentTitle') }}
                    </h2>
                    <p class="mt-3 text-sm leading-6 text-muted">
                        {{ t('skillInstall.agentDescription') }}
                    </p>
                    <SkillChatDemo
                        class="my-5"
                        :title="t('skillInstall.installPreview')"
                        :request="agentPrompt"
                        :reply="t('skillInstall.previewReply')"
                        :complete-label="t('skillInstall.previewComplete')"
                        installation
                    />
                    <div class="mt-auto flex flex-wrap items-center gap-4">
                        <button
                            type="button"
                            :disabled="copying"
                            class="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-full bg-ink px-5 py-3 text-sm font-semibold text-surface transition hover:opacity-90 disabled:opacity-50"
                            @click="copy(agentPrompt)"
                        >
                            <AppIcon name="copy" size="sm" />{{ t('skillInstall.copyPrompt') }}
                        </button>
                    </div>
                </section>
                <section
                    class="flex min-w-0 flex-col rounded-3xl border border-line bg-surface p-6 sm:p-8"
                    data-testid="skill-functions"
                >
                    <div class="mb-6 flex items-center justify-between">
                        <span
                            class="grid size-12 place-items-center rounded-2xl bg-brand/10 text-brand"
                        >
                            <AppIcon name="workspace" size="lg" />
                        </span>
                        <span
                            class="rounded-full border border-line px-3 py-1 text-xs font-semibold text-muted"
                        >{{ t('skillInstall.functionsBadge') }}</span
                        >
                    </div>
                    <h2 class="text-xl font-semibold text-ink">
                        {{ t('skillInstall.functionsTitle') }}
                    </h2>
                    <p class="mt-3 text-sm leading-6 text-muted">
                        {{ t('skillInstall.functionsDescription') }}
                    </p>
                    <div class="mt-6 grid gap-3">
                        <a
                            href="/api/skill/download"
                            download
                            class="group flex items-center gap-4 rounded-2xl border border-line bg-canvas p-4 transition hover:border-brand/40 hover:bg-brand/5"
                        >
                            <span
                                class="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand"
                            ><AppIcon name="download"
                            /></span>
                            <span class="min-w-0 flex-1">
                                <span class="block text-sm font-semibold text-ink">{{
                                    t('skillInstall.download')
                                }}</span>
                                <span class="mt-1 block text-xs leading-5 text-muted">{{
                                    t('skillInstall.downloadDescription')
                                }}</span>
                            </span>
                            <AppIcon
                                name="arrow-right"
                                size="sm"
                                class="shrink-0 text-muted transition group-hover:text-brand"
                            />
                        </a>
                        <RouterLink
                            to="/skill/authorize"
                            class="group flex items-center gap-4 rounded-2xl border border-line bg-canvas p-4 transition hover:border-brand/40 hover:bg-brand/5"
                        >
                            <span
                                class="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand"
                            ><AppIcon name="shield"
                            /></span>
                            <span class="min-w-0 flex-1">
                                <span class="block text-sm font-semibold text-ink">{{
                                    t('skillInstall.authorize')
                                }}</span>
                                <span class="mt-1 block text-xs leading-5 text-muted">{{
                                    t('skillInstall.authorizeDescription')
                                }}</span>
                            </span>
                            <AppIcon
                                name="arrow-right"
                                size="sm"
                                class="shrink-0 text-muted transition group-hover:text-brand"
                            />
                        </RouterLink>
                        <RouterLink
                            to="/skill/devices"
                            class="group flex items-center gap-4 rounded-2xl border border-line bg-canvas p-4 transition hover:border-brand/40 hover:bg-brand/5"
                        >
                            <span
                                class="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand"
                            ><AppIcon name="monitor"
                            /></span>
                            <span class="min-w-0 flex-1">
                                <span class="block text-sm font-semibold text-ink">{{
                                    t('skillAuth.devices')
                                }}</span>
                                <span class="mt-1 block text-xs leading-5 text-muted">{{
                                    t('skillInstall.devicesDescription')
                                }}</span>
                            </span>
                            <AppIcon
                                name="arrow-right"
                                size="sm"
                                class="shrink-0 text-muted transition group-hover:text-brand"
                            />
                        </RouterLink>
                    </div>
                </section>
            </div>
            <p v-if="copyError" role="alert" class="mt-4 text-sm text-red-700 dark:text-red-200">
                {{ t('skillInstall.copyError') }}
            </p>

            <section class="mt-8 rounded-3xl border border-line bg-surface p-6 sm:p-8">
                <h2 class="text-xl font-semibold">{{ t('skillInstall.nextTitle') }}</h2>
                <p class="mt-3 text-sm leading-7 text-muted">
                    {{ t('skillInstall.nextDescription') }}
                </p>
                <SkillUsageExamples />
            </section>
        </div>
    </main>
    <ToastMessage :visible="copied" :message="t('skillInstall.copied')" />
</template>
