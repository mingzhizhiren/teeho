<script setup lang="ts">
import { computed, ref } from 'vue'
import { useIllustrationMotion } from '@/composables/useIllustrationMotion'

const props = withDefaults(
    defineProps<{
        variant?:
            | 'studio'
            | 'report'
            | 'coffee'
            | 'plant'
            | 'blogger'
            | 'video'
            | 'operator'
            | 'error'
            | 'inspiration'
        motion?: 'lively' | 'calm'
        eager?: boolean
        interactiveReport?: boolean
    }>(),
    { variant: 'report', motion: 'calm', eager: false, interactiveReport: false },
)
const scene = ref<HTMLElement | null>(null)
const { phase, isReady, isInitialized, isMoving } = useIllustrationMotion(
    scene,
    () => props.motion === 'lively',
)
const isStudio = computed(() => props.variant === 'studio')
const loading = computed(() => (props.eager ? 'eager' : 'lazy'))
const characterSource = computed(
    () =>
        ({
            blogger: '/images/art/creator.webp',
            video: '/images/art/creator-video.webp',
            operator: '/images/art/creator-operator.webp',
        })[props.variant as 'blogger' | 'video' | 'operator'],
)
</script>

<template>
    <div
        ref="scene"
        class="art-scene"
        :class="'art-scene--' + variant"
        :data-ready="isReady"
        :data-initialized="isInitialized"
        :data-phase="phase"
        :data-moving="isMoving"
        :data-motion="motion"
        :data-character="characterSource ? variant : undefined"
        data-testid="art-scene"
    >
        <div class="art-composition" aria-hidden="true">
            <template v-if="isStudio">
                <div class="art-room art-enter" data-entry-y="0" data-entry-delay="0"></div>
                <div class="art-desk art-enter" data-entry-y="45" data-entry-delay="80"></div>
                <div
                    class="art-layer art-layer--plant art-enter"
                    data-entry-x="-48"
                    data-entry-y="12"
                    data-entry-delay="150"
                >
                    <img
                        data-art-idle="sway"
                        src="/images/art/plant.webp"
                        alt=""
                        width="480"
                        height="480"
                        :loading="loading"
                        decoding="async"
                    />
                </div>
                <div
                    class="art-layer art-layer--creator art-enter"
                    data-entry-x="-18"
                    data-entry-y="55"
                    data-entry-delay="280"
                >
                    <img
                        data-art-idle="breathe"
                        src="/images/art/creator.webp"
                        alt=""
                        width="960"
                        height="640"
                        :loading="loading"
                        :fetchpriority="eager ? 'high' : 'auto'"
                        decoding="async"
                    />
                </div>
                <div
                    class="art-layer art-layer--landscape art-enter"
                    data-entry-x="-38"
                    data-entry-y="-40"
                    data-entry-rotate="-12"
                    data-entry-delay="560"
                >
                    <div data-art-idle="float">
                        <div class="art-note art-note--landscape"></div>
                    </div>
                </div>
                <div
                    class="art-layer art-layer--note-coffee art-enter"
                    data-entry-x="36"
                    data-entry-y="-50"
                    data-entry-rotate="12"
                    data-entry-delay="660"
                >
                    <div data-art-idle="float"><div class="art-note art-note--coffee"></div></div>
                </div>
                <div
                    v-if="!$slots.report"
                    class="art-layer art-layer--note-plant art-enter"
                    data-entry-x="50"
                    data-entry-y="-20"
                    data-entry-delay="760"
                >
                    <div data-art-idle="float"><div class="art-note art-note--plant"></div></div>
                </div>
            </template>
            <div
                v-if="
                    variant === 'studio' ||
                        variant === 'report' ||
                        variant === 'error' ||
                        variant === 'inspiration'
                "
                class="art-layer art-layer--mascot art-enter"
                data-entry-x="45"
                data-entry-y="35"
                data-entry-rotate="-9"
                :data-entry-delay="isStudio ? 460 : 0"
            >
                <img
                    class="art-bob"
                    data-art-idle="float"
                    :src="
                        variant === 'error'
                            ? '/images/art/mascot-shrug.webp'
                            : variant === 'inspiration'
                                ? '/images/art/mascot-inspiration.webp'
                                : '/images/art/mascot-report.webp'
                    "
                    alt=""
                    width="480"
                    height="480"
                    :loading="loading"
                    decoding="async"
                />
            </div>
            <div
                v-if="variant === 'studio' || variant === 'coffee'"
                class="art-layer art-layer--coffee art-enter"
                data-entry-x="-20"
                data-entry-y="28"
                :data-entry-delay="isStudio ? 380 : 0"
            >
                <div class="art-steam">
                    <i data-art-idle="steam"></i><i data-art-idle="steam"></i>
                </div>
                <img
                    src="/images/art/coffee.webp"
                    alt=""
                    width="320"
                    height="320"
                    :loading="loading"
                    decoding="async"
                />
            </div>
            <div
                v-if="variant === 'plant'"
                class="art-layer art-layer--single-plant art-enter"
                data-entry-x="-20"
            >
                <img
                    data-art-idle="sway"
                    src="/images/art/plant.webp"
                    alt=""
                    width="480"
                    height="480"
                    :loading="loading"
                    decoding="async"
                />
            </div>
            <template v-if="characterSource">
                <div class="art-character-ground art-enter" data-entry-y="0"></div>
                <div
                    class="art-layer art-layer--person art-enter"
                    data-entry-x="-20"
                    data-entry-y="35"
                    data-entry-delay="150"
                >
                    <img
                        data-art-idle="breathe"
                        :src="characterSource"
                        alt=""
                        :width="variant === 'blogger' ? 960 : 600"
                        :height="variant === 'blogger' ? 640 : 600"
                        :loading="loading"
                        decoding="async"
                    />
                </div>
            </template>
            <div
                v-if="$slots.note"
                class="art-layer art-layer--handnote art-enter"
                data-entry-x="15"
                data-entry-y="30"
                data-entry-rotate="-8"
                data-entry-delay="950"
            >
                <slot name="note" />
            </div>
        </div>
        <div
            v-if="$slots.report"
            class="art-layer art-layer--peek art-enter"
            :class="{ 'art-layer--peek-interactive': interactiveReport }"
            :aria-hidden="interactiveReport ? undefined : true"
            data-entry-x="60"
            data-entry-y="-26"
            data-entry-rotate="7"
            data-entry-delay="780"
        >
            <div :data-art-idle="interactiveReport ? undefined : 'float'">
                <slot name="report" />
            </div>
        </div>
    </div>
</template>

<style scoped>
.art-scene {
    --art-pointer-x: 0px;
    --art-pointer-y: 0px;
    position: relative;
    isolation: isolate;
    width: 100%;
    aspect-ratio: 1;
}
.art-scene--studio {
    aspect-ratio: 1.1;
}
.art-composition {
    position: absolute;
    inset: 0;
    pointer-events: none;
}
.art-enter {
    opacity: 0;
    transform: translate(var(--assembly-x, 0px), var(--assembly-y, 0px))
        rotate(var(--assembly-rotate, 0deg));
}
.art-scene[data-phase='waiting'] .art-enter {
    opacity: 0;
}
.art-scene:not([data-initialized='true']) .art-enter {
    animation: art-static-fallback 1ms 3s forwards;
}
.art-layer {
    position: absolute;
    translate: calc(var(--art-pointer-x) * var(--depth, 1))
        calc(var(--art-pointer-y) * var(--depth, 1));
}
.art-layer img {
    display: block;
    width: 100%;
    height: auto;
    object-fit: contain;
}
.art-room {
    position: absolute;
    inset: 17% 0 12% 9%;
    background: linear-gradient(
        125deg,
        rgb(var(--color-surface-muted)),
        rgb(var(--color-brand) / 0.035)
    );
    clip-path: polygon(0 9%, 100% 0, 100% 100%, 0 100%);
}
.art-desk {
    position: absolute;
    inset: auto -2% 12% 0;
    height: 2%;
    border-radius: 2px;
    background: rgb(var(--color-accent) / 0.25);
}
.art-layer--creator {
    --depth: 0.15;
    left: -8%;
    bottom: 14%;
    width: 91%;
}
.art-layer--plant {
    --depth: -0.3;
    left: -10%;
    bottom: 17%;
    width: 39%;
}
.art-layer--mascot {
    inset: 4%;
}
.art-scene--studio .art-layer--mascot {
    --depth: 0.45;
    inset: auto -2% 10% auto;
    width: 34%;
}
.art-layer--coffee {
    inset: 8%;
}
.art-scene--studio .art-layer--coffee {
    --depth: 0.3;
    inset: auto auto 11% 11%;
    width: 17%;
}
.art-layer--single-plant {
    inset: 0;
}
.art-layer--landscape {
    --depth: -1;
    width: 16%;
    height: 24%;
    top: 3%;
    left: 6%;
}
.art-layer--note-coffee {
    --depth: 1.2;
    width: 16%;
    height: 24%;
    top: 5%;
    left: 29%;
}
.art-layer--note-plant {
    --depth: 0.85;
    width: 17%;
    height: 25%;
    top: 16%;
    right: 6%;
}
.art-layer--landscape > div,
.art-layer--note-coffee > div,
.art-layer--note-plant > div {
    width: 100%;
    height: 100%;
}
.art-layer--peek {
    --depth: 0.5;
    right: -1%;
    top: 6%;
    width: 43%;
    z-index: 2;
    rotate: 3deg;
}
.art-layer--peek-interactive {
    --depth: 0;
    pointer-events: auto;
}
.art-layer--handnote {
    --depth: 0.4;
    right: 8%;
    bottom: 0;
    max-width: 65%;
}
.art-note {
    width: 100%;
    height: 100%;
    background-repeat: no-repeat;
    filter: drop-shadow(0 6px 7px rgb(var(--color-text) / 0.07));
}
.art-note--landscape {
    background-image: url('/images/art/note-landscape.webp');
    background-size: 882% 400%;
    background-position: 64% 26.67%;
    rotate: -7deg;
}
.art-note--coffee {
    background-image: url('/images/art/note-coffee.webp');
    background-size: 882% 400%;
    background-position: 79.45% 12.44%;
    rotate: 6deg;
}
.art-note--plant {
    background-image: url('/images/art/note-plant.webp');
    background-size: 957% 441%;
    background-position: 94.54% 27.8%;
    rotate: 6deg;
}
.art-steam {
    position: absolute;
    top: 2%;
    left: 36%;
    display: flex;
    gap: 15%;
    width: 28%;
    height: 18%;
}
.art-steam i {
    width: 22%;
    height: 100%;
    border-left: 1px solid rgb(var(--color-text-muted) / 0.5);
    border-radius: 50%;
}
.art-layer--person {
    --depth: 0.3;
    inset: 0 3%;
}
.art-layer--person img {
    height: 100%;
    object-fit: contain;
    transform-origin: 50% 100%;
}
.art-scene--blogger .art-layer--person {
    inset: 3% -13% 0;
}
.art-character-ground {
    position: absolute;
    inset: 20% 9% 0;
    border-radius: 45% 45% 5% 5%;
    background: linear-gradient(180deg, transparent, rgb(var(--color-accent) / 0.07));
}
@keyframes art-static-fallback {
    to {
        opacity: 1;
    }
}
@media (max-width: 639px) {
    .art-layer--peek {
        display: none;
    }
    .art-layer--creator {
        left: -4%;
        width: 100%;
    }
    .art-layer--note-coffee {
        left: auto;
        right: 2%;
        top: 8%;
    }
}
@media (prefers-reduced-motion: reduce) {
    .art-layer {
        translate: none;
    }
    .art-enter {
        opacity: 1 !important;
        transform: none !important;
        animation: none !important;
    }
}
</style>
