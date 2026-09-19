<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import PublicSiteLayout from '@/components/PublicSiteLayout.vue'

const { t } = useI18n()
</script>

<template>
    <PublicSiteLayout>
        <main class="flex flex-1 items-center justify-center px-5 py-12 text-center sm:py-16">
            <div class="max-w-2xl">
                <img
                    class="mx-auto h-auto w-full max-w-sm select-none"
                    src="/images/illustrations/not-found.png"
                    width="768"
                    height="512"
                    alt=""
                    aria-hidden="true"
                    decoding="async"
                    data-testid="not-found-illustration"
                />
                <p class="text-base font-semibold uppercase tracking-[0.3em] text-brand sm:text-lg">
                    404
                </p>
                <h1 class="mt-4 text-5xl font-semibold tracking-tight sm:text-6xl">
                    {{ t('notFound.title') }}
                </h1>
                <p class="mt-5 text-lg leading-8 text-muted">{{ t('notFound.description') }}</p>
                <RouterLink
                    class="mt-8 inline-flex rounded-full bg-ink px-6 py-3 text-sm font-semibold text-surface"
                    to="/"
                >
                    {{ t('notFound.backHome') }}
                </RouterLink>
            </div>
        </main>
    </PublicSiteLayout>
</template>
