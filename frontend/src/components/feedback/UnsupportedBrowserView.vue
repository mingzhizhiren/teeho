<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import BrandMark from '@/components/BrandMark.vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import type { BrowserFeature } from '@/utils/browserFeatures'

const props = defineProps<{
    unsupportedFeatures: readonly BrowserFeature[]
}>()

const { t } = useI18n()
const featureLabels = computed(() =>
    props.unsupportedFeatures.map((feature) => t(`browser.features.${feature}`)),
)

function retryDetection() {
    window.location.reload()
}
</script>

<template>
    <main
        class="flex min-h-screen items-center justify-center bg-canvas px-5 py-12 text-ink sm:px-8"
        aria-labelledby="unsupported-browser-title"
        data-testid="unsupported-browser-view"
    >
        <section class="w-full max-w-xl rounded-3xl border border-line bg-surface p-6 sm:p-10">
            <BrandMark compact />

            <div
                class="mt-8 flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100"
            >
                <AppIcon name="warning" size="lg" />
            </div>

            <h1 id="unsupported-browser-title" class="mt-5 text-2xl font-semibold sm:text-3xl">
                {{ t('browser.unsupported.title') }}
            </h1>
            <p class="mt-3 text-sm leading-6 text-muted sm:text-base sm:leading-7">
                {{ t('browser.unsupported.description') }}
            </p>

            <div class="mt-6 rounded-2xl bg-surface-muted p-4">
                <p class="text-sm font-semibold text-ink">
                    {{ t('browser.unsupported.missingFeatures') }}
                </p>
                <ul class="mt-2 space-y-1 text-sm leading-6 text-muted">
                    <li v-for="feature in featureLabels" :key="feature">• {{ feature }}</li>
                </ul>
            </div>

            <p class="mt-6 text-sm leading-6 text-muted">
                {{ t('browser.unsupported.recommendation') }}
            </p>
            <button
                class="mt-6 min-h-12 w-full rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-on-brand transition hover:bg-brand-hover focus-visible:outline-none sm:w-auto"
                type="button"
                @click="retryDetection"
            >
                {{ t('browser.unsupported.retry') }}
            </button>
        </section>
    </main>
</template>
