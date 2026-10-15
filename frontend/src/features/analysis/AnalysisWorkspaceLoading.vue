<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AnalysisWaitingScene from '@/components/art/AnalysisWaitingScene.vue'

const { t } = useI18n()
</script>

<template>
    <div
        class="workspace-loading flex min-h-[30rem] min-w-0 w-full items-center justify-center overflow-hidden rounded-3xl border border-line bg-surface px-4 py-8 text-center sm:px-8 lg:col-span-2 lg:h-full lg:min-h-0"
        data-testid="analysis-workspace-loading"
        role="status"
        aria-live="polite"
        aria-busy="true"
    >
        <div class="min-w-0 w-full max-w-3xl">
            <AnalysisWaitingScene variant="loading" />
            <div
                class="mt-5 flex items-center justify-center gap-2 text-xs font-semibold tracking-widest text-brand"
            >
                <img
                    src="/images/main/small_LOGO.png"
                    width="24"
                    height="24"
                    alt=""
                    aria-hidden="true"
                    data-testid="analysis-workspace-loading-logo"
                />
                {{ t('workspace.analysisEngineName') }}
            </div>
            <h1 class="mt-3 text-xl font-semibold text-ink sm:text-3xl">
                {{ t('workspace.loadingPage.title') }}
            </h1>
            <p class="mx-auto mt-3 max-w-md text-sm leading-6 text-muted">
                {{ t('workspace.loadingPage.description') }}
            </p>
            <p class="mt-5 text-xs tracking-widest text-brand">
                {{ t('workspace.loadingPage.status') }}
            </p>
        </div>
    </div>
</template>

<style scoped>
.workspace-loading {
    background-image: radial-gradient(
        ellipse at 50% 45%,
        rgb(var(--color-brand-glow) / 0.06),
        transparent 65%
    );
}
</style>
