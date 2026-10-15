<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import BrandMark from '@/components/BrandMark.vue'
import AuthLibraryScene from '@/components/art/AuthLibraryScene.vue'
import PublicSiteLayout from '@/components/PublicSiteLayout.vue'

const { t } = useI18n()
const currentYear = computed(() => new Date().getFullYear())
</script>

<template>
    <PublicSiteLayout>
        <main
            class="ui-auth-layout grid min-h-[calc(100vh-5rem)] bg-surface lg:grid-cols-[minmax(0,1.08fr)_minmax(460px,0.92fr)]"
        >
            <section
                class="ui-auth-story relative isolate hidden overflow-hidden border-r border-line bg-canvas px-12 py-10 text-ink lg:flex lg:flex-col"
                data-testid="auth-brand-panel"
            >
                <div class="relative max-w-xl pt-6">
                    <p class="mb-5 text-sm font-medium text-brand">
                        {{ t('auth.heroEyebrow') }}
                    </p>
                    <h1 class="text-5xl font-semibold leading-[1.12] tracking-[-0.04em]">
                        {{ t('auth.heroTitleLine1') }}<br />{{ t('auth.heroTitleLine2') }}
                    </h1>
                    <p class="mt-7 max-w-md text-base leading-7 text-muted">
                        {{ t('auth.heroDescription') }}
                    </p>
                </div>

                <AuthLibraryScene
                    class="mx-auto my-8 max-w-lg"
                    data-testid="auth-brand-visual"
                />

                <p class="relative mt-auto text-xs text-muted">
                    © {{ currentYear }} {{ t('common.appName') }}
                </p>
            </section>

            <section
                class="ui-auth-form relative flex min-h-[calc(100dvh-5rem)] items-center justify-center px-6 py-12 sm:px-12"
            >
                <div class="ui-auth-card w-full max-w-sm">
                    <div class="mb-10 flex items-center justify-between gap-4 lg:hidden">
                        <BrandMark compact />
                        <img
                            src="/images/main/LOGO_xhs.png"
                            :alt="t('auth.xhsLogoAlt')"
                            width="44"
                            height="44"
                            class="size-11 rounded-xl"
                        />
                    </div>
                    <slot />
                </div>
            </section>
        </main>
    </PublicSiteLayout>
</template>
