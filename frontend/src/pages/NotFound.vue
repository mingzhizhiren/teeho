<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import PublicSiteLayout from '@/components/PublicSiteLayout.vue'
import ArtScene from '@/components/art/ArtScene.vue'

const { t } = useI18n()
</script>

<template>
    <PublicSiteLayout>
        <main
            class="ui-not-found flex flex-1 items-center justify-center px-5 py-12 text-center sm:py-16"
        >
            <div class="ui-empty-state max-w-2xl">
                <ArtScene
                    class="mx-auto max-w-56"
                    variant="error"
                    motion="calm"
                    eager
                    data-testid="not-found-illustration"
                />
                <p class="text-base font-semibold uppercase tracking-[0.3em] text-brand sm:text-lg">
                    404
                </p>
                <h1 class="mt-4 text-5xl font-semibold tracking-tight sm:text-6xl">
                    {{ t('notFound.title') }}
                </h1>
                <p class="mt-5 text-lg leading-8 text-muted">{{ t('notFound.description') }}</p>
                <RouterLink class="app-button app-button--primary app-button--md mt-8" to="/">
                    {{ t('notFound.backHome') }}
                </RouterLink>
            </div>
        </main>
    </PublicSiteLayout>
</template>
