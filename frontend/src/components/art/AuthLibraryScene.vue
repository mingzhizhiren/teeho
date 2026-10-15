<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIllustrationMotion } from '@/composables/useIllustrationMotion'

const { t } = useI18n()
const scene = ref<HTMLElement | null>(null)
const { phase, isReady, isInitialized, isMoving } = useIllustrationMotion(scene, () => true)
const shelves = ['upper', 'middle', 'lower'] as const
const books = ['tall', 'slim', 'short', 'leaning', 'wide'] as const
</script>

<template>
    <div
        ref="scene"
        class="auth-library-scene"
        :data-phase="phase"
        :data-ready="isReady"
        :data-initialized="isInitialized"
        :data-moving="isMoving"
    >
        <div class="library-window art-enter" data-entry-y="0" aria-hidden="true"></div>
        <div
            class="library-shelves art-enter"
            data-entry-x="-35"
            data-entry-delay="120"
            aria-hidden="true"
        >
            <div v-for="shelf in shelves" :key="shelf" class="library-shelf">
                <span
                    v-for="book in books"
                    :key="book"
                    class="library-book"
                    :class="'library-book--' + book"
                ></span>
            </div>
        </div>
        <div
            class="library-reader art-enter"
            data-entry-y="35"
            data-entry-delay="320"
            aria-hidden="true"
        >
            <img
                src="/images/art/creator-reading.webp"
                width="960"
                height="640"
                alt=""
                loading="eager"
                decoding="async"
                fetchpriority="high"
            />
        </div>
        <div
            class="library-xhs art-enter"
            data-entry-y="-25"
            data-entry-rotate="-8"
            data-entry-delay="700"
        >
            <img
                data-art-idle="float"
                src="/images/main/LOGO_xhs.png"
                :alt="t('auth.xhsLogoAlt')"
                width="88"
                height="88"
                class="library-xhs-icon"
            />
        </div>
    </div>
</template>

<style scoped>
.auth-library-scene {
    position: relative;
    isolation: isolate;
    width: 100%;
    aspect-ratio: 1.18;
    --art-pointer-x: 0px;
    --art-pointer-y: 0px;
}
.art-enter {
    opacity: 0;
    transform: translate(var(--assembly-x, 0px), var(--assembly-y, 0px))
        rotate(var(--assembly-rotate, 0deg));
}
.auth-library-scene:not([data-initialized='true']) .art-enter {
    animation: library-fallback 1ms 3s forwards;
}
.library-window {
    position: absolute;
    top: 1%;
    right: 10%;
    width: 43%;
    height: 63%;
    border: 1px solid rgb(var(--color-border));
    border-radius: 50% 50% 0 0;
    background: linear-gradient(150deg, rgb(var(--color-accent) / 0.12), transparent);
}
.library-shelves {
    position: absolute;
    top: 9%;
    left: 4%;
    width: 38%;
    height: 57%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    border-inline: 5px solid rgb(var(--color-accent) / 0.28);
    padding: 0 6px;
    background: rgb(var(--color-surface-muted) / 0.6);
    translate: calc(var(--art-pointer-x) * -0.15) 0;
}
.library-shelf {
    display: flex;
    align-items: flex-end;
    gap: 5%;
    height: 30%;
    padding: 0 8%;
    border-bottom: 5px solid rgb(var(--color-accent) / 0.35);
}
.library-book {
    width: 15%;
    height: 80%;
    border: 1px solid rgb(var(--color-text) / 0.12);
    border-radius: 2px 3px 0 0;
    background: rgb(var(--color-accent) / 0.4);
    box-shadow: inset 0 5px rgb(var(--color-surface) / 0.25);
}
.library-book--tall {
    height: 94%;
}
.library-book--slim {
    width: 10%;
    background: rgb(var(--color-brand) / 0.35);
}
.library-book--short {
    height: 67%;
    background: rgb(var(--color-text-muted) / 0.35);
}
.library-book--leaning {
    rotate: -12deg;
    height: 85%;
    transform-origin: bottom;
}
.library-book--wide {
    width: 22%;
    height: 75%;
    background: rgb(var(--color-brand) / 0.2);
}
.library-reader {
    position: absolute;
    width: 103%;
    bottom: 0;
    left: -1%;
}
.library-reader img {
    display: block;
    width: 100%;
    height: auto;
}
.library-xhs {
    position: absolute;
    top: 5%;
    right: 2%;
    width: 17%;
    max-width: 88px;
    translate: calc(var(--art-pointer-x) * 0.3) calc(var(--art-pointer-y) * 0.3);
}
.library-xhs-icon {
    display: block;
    width: 100%;
    height: auto;
    border-radius: 22%;
}
@keyframes library-fallback {
    to {
        opacity: 1;
    }
}
@media (prefers-reduced-motion: reduce) {
    .art-enter {
        opacity: 1 !important;
        transform: none !important;
        animation: none !important;
    }
    .library-shelves,
    .library-xhs {
        translate: none;
    }
}
</style>
