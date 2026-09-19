<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
    <div
        class="workspace-loading relative flex min-h-[32rem] w-full overflow-hidden rounded-3xl border border-line bg-surface px-6 py-12 text-center shadow-sm lg:col-span-2 lg:h-full lg:min-h-0"
        data-testid="analysis-workspace-loading"
        role="status"
        aria-live="polite"
        aria-busy="true"
    >
        <div class="workspace-loading-grid" aria-hidden="true"></div>
        <div class="workspace-loading-beam" aria-hidden="true"></div>

        <div class="relative z-10 m-auto flex max-w-xl flex-col items-center">
            <div class="workspace-loading-engine" aria-hidden="true">
                <span class="workspace-loading-aura"></span>
                <span class="workspace-loading-ring workspace-loading-ring-outer"></span>
                <span class="workspace-loading-ring workspace-loading-ring-inner"></span>
                <span class="workspace-loading-orbit-dot"></span>
                <span class="workspace-loading-core">
                    <img
                        class="h-10 w-10 object-contain"
                        src="/images/main/small_LOGO.png"
                        alt=""
                        aria-hidden="true"
                        data-testid="analysis-workspace-loading-logo"
                    />
                </span>
                <span class="workspace-loading-sparks">
                    <i v-for="spark in 10" :key="spark"></i>
                </span>
            </div>

            <p class="mt-8 text-xs font-semibold uppercase tracking-[0.22em] text-brand">
                {{ t('workspace.analysisEngineName') }}
            </p>
            <h1 class="mt-3 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
                {{ t('workspace.loadingPage.title') }}
            </h1>
            <p class="mt-3 max-w-md text-sm leading-6 text-muted">
                {{ t('workspace.loadingPage.description') }}
            </p>
            <p class="workspace-loading-status mt-6 text-sm font-bold tracking-[0.2em] text-brand">
                {{ t('workspace.loadingPage.status') }}
            </p>
        </div>
    </div>
</template>

<style scoped>
.workspace-loading {
    isolation: isolate;
    background-image:
        radial-gradient(circle at 50% 42%, rgb(var(--color-brand) / 0.12), transparent 24rem),
        radial-gradient(circle at 18% 18%, rgb(var(--color-brand-glow) / 0.07), transparent 18rem),
        linear-gradient(145deg, rgb(var(--color-surface)), rgb(var(--color-surface-muted) / 0.72));
}

.workspace-loading-grid {
    position: absolute;
    inset: 0;
    background-image:
        linear-gradient(rgb(var(--color-brand) / 0.055) 1px, transparent 1px),
        linear-gradient(90deg, rgb(var(--color-brand) / 0.055) 1px, transparent 1px);
    background-size: 3rem 3rem;
    mask-image: radial-gradient(circle at center, black, transparent 72%);
    opacity: 0.6;
}

.workspace-loading-beam {
    position: absolute;
    top: -35%;
    left: 50%;
    width: 8rem;
    height: 170%;
    transform: translateX(-50%) rotate(28deg);
    background: linear-gradient(
        90deg,
        transparent,
        rgb(var(--color-brand-glow) / 0.08),
        transparent
    );
    filter: blur(0.75rem);
    animation: workspace-loading-scan 3.8s ease-in-out infinite;
}

.workspace-loading-engine {
    position: relative;
    width: 11rem;
    height: 11rem;
}

.workspace-loading-aura {
    position: absolute;
    inset: 1.25rem;
    border-radius: 9999px;
    background: rgb(var(--color-brand) / 0.14);
    box-shadow:
        0 0 3rem rgb(var(--color-brand) / 0.3),
        0 0 6rem rgb(var(--color-brand-glow) / 0.12);
    animation: workspace-loading-pulse 2.2s ease-in-out infinite;
}

.workspace-loading-ring {
    position: absolute;
    border-radius: 9999px;
}

.workspace-loading-ring-outer {
    inset: 0;
    border: 1px dashed rgb(var(--color-brand) / 0.45);
    animation: workspace-loading-spin 8s linear infinite;
}

.workspace-loading-ring-inner {
    inset: 1.3rem;
    border: 2px solid rgb(var(--color-brand) / 0.18);
    border-top-color: rgb(var(--color-brand));
    border-bottom-color: rgb(var(--color-brand-glow) / 0.72);
    animation: workspace-loading-spin-reverse 2.8s linear infinite;
}

.workspace-loading-orbit-dot {
    position: absolute;
    top: 0.25rem;
    left: 50%;
    width: 0.65rem;
    height: 0.65rem;
    transform: translateX(-50%);
    border-radius: 9999px;
    background: rgb(var(--color-brand-glow));
    box-shadow: 0 0 1rem rgb(var(--color-brand-glow) / 0.8);
    transform-origin: 50% 5.25rem;
    animation: workspace-loading-orbit 3.2s linear infinite;
}

.workspace-loading-core {
    position: absolute;
    inset: 3.3rem;
    display: grid;
    place-items: center;
    border: 1px solid rgb(var(--color-brand) / 0.42);
    border-radius: 1.5rem;
    background: rgb(var(--color-surface) / 0.88);
    color: rgb(var(--color-brand));
    box-shadow:
        inset 0 1px 0 rgb(var(--color-brand-glow) / 0.18),
        0 0 2rem rgb(var(--color-brand) / 0.22);
    backdrop-filter: blur(0.75rem);
}

.workspace-loading-sparks {
    position: absolute;
    inset: 0;
}

.workspace-loading-sparks i {
    position: absolute;
    left: 50%;
    bottom: 44%;
    width: 0.2rem;
    height: 0.2rem;
    border-radius: 9999px;
    background: rgb(var(--color-brand-glow));
    box-shadow: 0 0 0.65rem rgb(var(--color-brand-glow) / 0.85);
    opacity: 0;
    animation: workspace-loading-spark 2.6s ease-out infinite;
}

.workspace-loading-sparks i:nth-child(2n) {
    background: rgb(var(--color-brand));
}

.workspace-loading-sparks i:nth-child(1) {
    --spark-x: -4.8rem;
    animation-delay: -0.2s;
}

.workspace-loading-sparks i:nth-child(2) {
    --spark-x: 4.4rem;
    animation-delay: -0.7s;
}

.workspace-loading-sparks i:nth-child(3) {
    --spark-x: -3.2rem;
    animation-delay: -1.2s;
}

.workspace-loading-sparks i:nth-child(4) {
    --spark-x: 3.6rem;
    animation-delay: -1.7s;
}

.workspace-loading-sparks i:nth-child(5) {
    --spark-x: -1.6rem;
    animation-delay: -2.2s;
}

.workspace-loading-sparks i:nth-child(6) {
    --spark-x: 1.8rem;
    animation-delay: -0.45s;
}

.workspace-loading-sparks i:nth-child(7) {
    --spark-x: -4rem;
    animation-delay: -0.95s;
}

.workspace-loading-sparks i:nth-child(8) {
    --spark-x: 4.9rem;
    animation-delay: -1.45s;
}

.workspace-loading-sparks i:nth-child(9) {
    --spark-x: -2.5rem;
    animation-delay: -1.95s;
}

.workspace-loading-sparks i:nth-child(10) {
    --spark-x: 2.7rem;
    animation-delay: -2.45s;
}

.workspace-loading-status {
    background: linear-gradient(
        90deg,
        rgb(var(--color-brand)),
        rgb(var(--color-brand-glow)),
        rgb(var(--color-brand))
    );
    background-size: 200% auto;
    color: transparent;
    background-clip: text;
    animation: workspace-loading-text 1.8s linear infinite;
}

@keyframes workspace-loading-spin {
    to {
        transform: rotate(360deg);
    }
}

@keyframes workspace-loading-spin-reverse {
    to {
        transform: rotate(-360deg);
    }
}

@keyframes workspace-loading-orbit {
    to {
        transform: translateX(-50%) rotate(360deg);
    }
}

@keyframes workspace-loading-pulse {
    50% {
        transform: scale(1.08);
        opacity: 0.72;
    }
}

@keyframes workspace-loading-scan {
    0%,
    100% {
        transform: translateX(-210%) rotate(28deg);
        opacity: 0;
    }
    45%,
    55% {
        opacity: 1;
    }
    50% {
        transform: translateX(110%) rotate(28deg);
    }
}

@keyframes workspace-loading-spark {
    0% {
        transform: translate3d(0, 1rem, 0) scale(0.5);
        opacity: 0;
    }
    20% {
        opacity: 0.9;
    }
    100% {
        transform: translate3d(var(--spark-x), -5.8rem, 0) scale(0.1);
        opacity: 0;
    }
}

@keyframes workspace-loading-text {
    to {
        background-position: -200% center;
    }
}

@media (prefers-reduced-motion: reduce) {
    .workspace-loading-beam,
    .workspace-loading-aura,
    .workspace-loading-ring,
    .workspace-loading-orbit-dot,
    .workspace-loading-sparks i,
    .workspace-loading-status {
        animation: none;
    }

    .workspace-loading-sparks i {
        display: none;
    }
}
</style>
