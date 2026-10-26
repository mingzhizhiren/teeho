<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{
    message: 'perspective' | 'nextPost' | 'workspace' | 'report' | 'skill' | 'inspiration'
    signature?: boolean
}>()
const { t, locale } = useI18n()
</script>

<template>
    <p class="art-note-copy" :lang="locale" data-testid="art-note">
        <span><slot>{{ t(`common.art.${message}`) }}</slot></span>
        <span v-if="signature" class="art-signature">— {{ t('common.art.signature') }}</span>
    </p>
</template>

<style scoped>
.art-note-copy {
    width: fit-content;
    max-width: 24rem;
    color: rgb(var(--color-text-muted));
    font-family: 'Kaiti SC', STKaiti, KaiTi, 'Segoe Print', 'Bradley Hand', cursive;
    font-size: clamp(1rem, 1.4vw, 1.2rem);
    line-height: 1.8;
    letter-spacing: 0.045em;
    transform: rotate(-3deg);
}
.art-note-copy:lang(en-US) {
    font-family: 'Segoe Print', 'Bradley Hand', cursive;
    letter-spacing: 0;
}
.art-note-copy > span:first-child {
    background: linear-gradient(transparent 88%, rgb(var(--color-brand) / 0.14) 88%);
}
.art-signature {
    display: block;
    margin-top: 0.3rem;
    text-align: right;
    font-size: 0.85em;
}
.art-signature::after {
    content: '';
    display: block;
    width: 4rem;
    height: 0.4rem;
    margin-left: auto;
    border-top: 2px solid rgb(var(--color-brand));
    border-radius: 50%;
    transform: rotate(-8deg);
}
</style>
