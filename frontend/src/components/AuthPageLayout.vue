<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import BrandMark from '@/components/BrandMark.vue'
import PublicSiteLayout from '@/components/PublicSiteLayout.vue'
import { useTheme } from '@/composables/useTheme'

const { t } = useI18n()
const { effectiveTheme } = useTheme()
const currentYear = computed(() => new Date().getFullYear())
</script>

<template>
    <PublicSiteLayout>
        <main
            class="grid min-h-[calc(100vh-5rem)] bg-surface lg:grid-cols-[minmax(0,1.08fr)_minmax(460px,0.92fr)]"
        >
            <section
                class="relative isolate hidden overflow-hidden bg-canvas px-12 py-10 text-ink lg:flex lg:flex-col"
                data-testid="auth-brand-panel"
            >
                <div
                    class="auth-brand-visual absolute inset-0"
                    :class="{ 'auth-brand-visual-dark': effectiveTheme === 'dark' }"
                    data-testid="auth-brand-visual"
                    aria-hidden="true"
                ></div>
                <div
                    class="auth-brand-wash absolute inset-0"
                    :class="{ 'auth-brand-wash-dark': effectiveTheme === 'dark' }"
                    aria-hidden="true"
                ></div>
                <div
                    class="auth-brand-bottom absolute inset-x-0 bottom-0 h-48"
                    aria-hidden="true"
                ></div>

                <div class="relative my-auto max-w-xl pb-12">
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

                <p class="relative text-xs text-muted/70">
                    © {{ currentYear }} {{ t('common.appName') }}
                </p>
            </section>

            <section
                class="relative flex min-h-screen items-center justify-center px-6 py-12 sm:px-12"
            >
                <div class="w-full max-w-sm">
                    <BrandMark class="mb-10 lg:hidden" compact />
                    <slot />
                </div>
            </section>
        </main>
    </PublicSiteLayout>
</template>

<style scoped>
@media (min-width: 1024px) {
    .auth-brand-visual {
        background-image: url('/images/illustrations/auth-brand-scene.webp');
        background-position: center;
        background-size: cover;
        opacity: 0.24;
    }

    .auth-brand-wash {
        background: linear-gradient(
            90deg,
            rgb(var(--color-canvas) / 0.98) 0%,
            rgb(var(--color-canvas) / 0.9) 48%,
            rgb(var(--color-canvas) / 0.62) 100%
        );
    }

    .auth-brand-bottom {
        background: linear-gradient(0deg, rgb(var(--color-canvas)) 0%, transparent 100%);
    }

    .auth-brand-visual-dark {
        opacity: 0.72;
    }

    .auth-brand-wash-dark {
        background: linear-gradient(
            90deg,
            rgb(var(--color-canvas) / 0.98) 0%,
            rgb(var(--color-canvas) / 0.86) 48%,
            rgb(var(--color-canvas) / 0.22) 100%
        );
    }
}
</style>
