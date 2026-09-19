<template>
    <section
        class="ritual-shell mt-7 overflow-hidden rounded-[2rem] border border-line"
        :class="[`ritual-${effectivePhase}`, `ritual-variant-${variant.toLowerCase()}`]"
        :data-ritual-variant="variant"
        role="status"
        aria-live="polite"
    >
        <div class="ritual-grid" aria-hidden="true"></div>
        <div class="ritual-aurora ritual-aurora-left" aria-hidden="true"></div>
        <div class="ritual-aurora ritual-aurora-right" aria-hidden="true"></div>

        <header
            class="relative z-10 flex flex-wrap items-center justify-between gap-3 px-5 pt-5 sm:px-7 sm:pt-7"
        >
            <div class="flex items-center gap-3">
                <span class="ritual-live-dot" aria-hidden="true"></span>
                <div>
                    <p class="text-[10px] font-bold uppercase tracking-[0.28em] text-brand">
                        {{ t('workspace.ritual.eyebrow') }}
                    </p>
                    <h2 class="mt-1 text-sm font-semibold text-ink sm:text-base">
                        {{ t(`workspace.ritual.phases.${effectivePhase}.title`) }}
                    </h2>
                </div>
            </div>
            <div class="flex items-center gap-2">
                <div
                    class="rounded-full border border-line bg-surface/70 px-3 py-1.5 text-xs text-muted"
                >
                    {{ statusMeta }}
                </div>
                <button
                    v-if="abandonable && !preview"
                    class="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-brand-vivid/60 hover:bg-brand-vivid/10 disabled:opacity-50"
                    type="button"
                    :disabled="busy"
                    @click="emit('abandon')"
                >
                    {{ t('workspace.abandonTask') }}
                </button>
            </div>
        </header>

        <div v-if="variant === 'A'" class="relative z-10 px-5 pb-6 pt-5 sm:px-7 sm:pb-7">
            <div class="ritual-a-stage">
                <svg
                    class="ritual-neural-threads"
                    viewBox="0 0 540 336"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                >
                    <defs>
                        <filter
                            id="ritual-thread-glow"
                            x="-40%"
                            y="-40%"
                            width="180%"
                            height="180%"
                        >
                            <feGaussianBlur stdDeviation="2.2" result="blur" />
                            <feMerge>
                                <feMergeNode in="blur" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                    </defs>
                    <g filter="url(#ritual-thread-glow)">
                        <path
                            class="ritual-thread ritual-thread-intent"
                            pathLength="1"
                            d="M270 168C211 147 185 80 72 72"
                        />
                        <path
                            class="ritual-thread ritual-thread-audience"
                            pathLength="1"
                            d="M270 168C333 139 366 83 471 84"
                        />
                        <path
                            class="ritual-thread ritual-thread-demand"
                            pathLength="1"
                            d="M270 168C199 191 181 253 64 264"
                        />
                        <path
                            class="ritual-thread ritual-thread-novelty"
                            pathLength="1"
                            d="M270 168C337 198 368 254 479 250"
                        />
                        <path
                            class="ritual-thread ritual-thread-expression"
                            pathLength="1"
                            d="M270 168C263 218 270 259 270 307"
                        />
                    </g>
                </svg>

                <div class="ritual-mote-field" aria-hidden="true">
                    <span v-for="index in consciousnessMoteCount" :key="index"></span>
                </div>

                <div class="ritual-core" aria-hidden="true">
                    <div class="ritual-core-glow"></div>
                    <div class="ritual-logo-halo"></div>
                    <svg class="ritual-digital-sphere" viewBox="0 0 180 180" fill="none">
                        <defs>
                            <clipPath id="ritual-sphere-clip">
                                <circle cx="90" cy="90" r="79" />
                            </clipPath>
                            <linearGradient
                                id="ritual-sphere-stroke"
                                x1="26"
                                y1="22"
                                x2="151"
                                y2="159"
                            >
                                <stop
                                    stop-color="rgb(var(--color-brand-glow))"
                                    stop-opacity="0.8"
                                />
                                <stop
                                    offset="0.48"
                                    stop-color="rgb(var(--color-brand-vivid))"
                                    stop-opacity="0.38"
                                />
                                <stop
                                    offset="1"
                                    stop-color="rgb(var(--color-brand-hot))"
                                    stop-opacity="0.16"
                                />
                            </linearGradient>
                            <radialGradient
                                id="ritual-sphere-glass"
                                cx="0"
                                cy="0"
                                r="1"
                                gradientTransform="translate(58 45) rotate(52) scale(126)"
                            >
                                <stop stop-color="rgb(var(--color-text))" stop-opacity="0.14" />
                                <stop
                                    offset="0.42"
                                    stop-color="rgb(var(--color-brand-vivid))"
                                    stop-opacity="0.035"
                                />
                                <stop
                                    offset="1"
                                    stop-color="rgb(var(--color-surface))"
                                    stop-opacity="0.58"
                                />
                            </radialGradient>
                        </defs>
                        <circle
                            cx="90"
                            cy="90"
                            r="80"
                            fill="url(#ritual-sphere-glass)"
                            stroke="url(#ritual-sphere-stroke)"
                            stroke-width="1.4"
                        />
                        <g
                            class="ritual-sphere-wireframe"
                            clip-path="url(#ritual-sphere-clip)"
                            stroke="url(#ritual-sphere-stroke)"
                        >
                            <ellipse cx="90" cy="90" rx="78" ry="28" />
                            <ellipse cx="90" cy="90" rx="78" ry="52" />
                            <ellipse cx="90" cy="90" rx="31" ry="79" />
                            <ellipse cx="90" cy="90" rx="56" ry="79" />
                            <path d="M18 64H46V49H67M114 34V55H145V72H171" />
                            <path d="M8 112H43V129H72V164M108 166V140H135V122H173" />
                            <path d="M50 82H70V67H86M94 115H112V99H135" />
                        </g>
                        <g class="ritual-sphere-nodes" fill="rgb(var(--color-brand-glow))">
                            <circle cx="46" cy="49" r="2.2" />
                            <circle cx="145" cy="72" r="2.2" />
                            <circle cx="43" cy="129" r="2.2" />
                            <circle cx="135" cy="122" r="2.2" />
                            <circle cx="70" cy="67" r="1.8" />
                            <circle cx="112" cy="99" r="1.8" />
                        </g>
                        <path
                            class="ritual-sphere-highlight"
                            d="M35 74C42 45 61 29 87 23"
                            stroke="rgb(var(--color-text))"
                            stroke-opacity="0.55"
                            stroke-width="3"
                            stroke-linecap="round"
                        />
                    </svg>
                    <div class="ritual-sphere-equator"></div>
                    <div class="ritual-energy-burst">
                        <span v-for="index in energyRayCount" :key="index"></span>
                    </div>
                    <svg class="ritual-flame" viewBox="0 0 80 104" fill="none">
                        <path
                            d="M45 2C48 22 30 29 32 47C24 42 21 34 22 27C9 40 2 54 4 69C6 89 21 102 40 102C61 102 76 87 76 66C76 50 66 38 54 29C56 42 49 50 43 51C47 36 53 22 45 2Z"
                            fill="url(#ritual-fire-gradient)"
                        />
                        <path
                            d="M41 47C43 60 31 65 33 76C28 72 27 68 27 64C20 73 24 91 40 94C51 94 59 85 57 75C55 66 49 60 41 47Z"
                            fill="rgb(var(--color-brand-glow))"
                        />
                        <defs>
                            <linearGradient
                                id="ritual-fire-gradient"
                                x1="16"
                                y1="12"
                                x2="68"
                                y2="94"
                            >
                                <stop stop-color="rgb(var(--color-brand-glow))" />
                                <stop offset="0.52" stop-color="rgb(var(--color-brand-vivid))" />
                                <stop offset="1" stop-color="rgb(var(--color-brand-hot))" />
                            </linearGradient>
                        </defs>
                    </svg>
                    <img class="ritual-logo" src="/images/main/small_LOGO.png" alt="" />
                    <strong class="ritual-core-value">{{ coreValue }}</strong>
                    <span class="ritual-core-label">{{ coreLabel }}</span>
                </div>
                <div
                    v-for="dimension in dimensions"
                    :key="dimension.key"
                    class="ritual-dimension-anchor"
                    :class="`ritual-dimension-anchor-${dimension.key}`"
                >
                    <span class="ritual-dimension">
                        <i aria-hidden="true"></i>
                        {{ dimension.label }}
                    </span>
                </div>
            </div>

            <p class="mx-auto max-w-xl text-center text-sm leading-6 text-muted">
                {{ t(`workspace.ritual.phases.${effectivePhase}.description`) }}
            </p>
            <div class="mx-auto mt-5 flex max-w-2xl flex-wrap justify-center gap-2">
                <span
                    v-for="dimension in dimensions"
                    :key="`chip-${dimension.key}`"
                    class="rounded-full border border-line bg-surface/70 px-3 py-1.5 text-[11px] text-muted"
                >
                    {{ dimension.label }}
                </span>
            </div>
        </div>

        <div v-else-if="variant === 'B'" class="relative z-10 px-5 pb-6 pt-7 sm:px-7 sm:pb-7">
            <div class="ritual-b-stage">
                <svg
                    class="ritual-constellation-lines"
                    viewBox="0 0 720 300"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                >
                    <path
                        d="M360 150L108 66M360 150L128 238M360 150L593 58M360 150L612 235M360 150L360 28"
                    />
                    <circle cx="360" cy="150" r="92" />
                </svg>
                <div class="ritual-b-core">
                    <img
                        v-if="effectivePhase === 'reveal'"
                        src="/images/main/small_LOGO.png"
                        alt=""
                    />
                    <span v-else class="ritual-b-spark">✦</span>
                    <strong>{{ coreValue }}</strong>
                    <small>{{ coreLabel }}</small>
                </div>
                <span
                    v-for="dimension in dimensions"
                    :key="dimension.key"
                    class="ritual-node"
                    :class="`ritual-node-${dimension.key}`"
                >
                    <i aria-hidden="true"></i>
                    {{ dimension.label }}
                </span>
            </div>
            <div class="ritual-signal-strip">
                <span
                    v-for="index in signalBarCount"
                    :key="index"
                    :style="{ '--signal-index': index }"
                ></span>
            </div>
            <p class="mt-4 text-center text-sm leading-6 text-muted">
                {{ t(`workspace.ritual.phases.${effectivePhase}.description`) }}
            </p>
        </div>

        <div v-else class="relative z-10 px-5 pb-6 pt-7 sm:px-7 sm:pb-7">
            <div class="ritual-c-stage">
                <div class="ritual-c-source">
                    <span class="ritual-c-source-fire" aria-hidden="true">🔥</span>
                    <small>{{ t('workspace.ritual.foundry.source') }}</small>
                </div>
                <div class="ritual-c-track" aria-hidden="true">
                    <span v-for="index in forgePlateCount" :key="index"></span>
                </div>
                <div class="ritual-c-output">
                    <div class="ritual-output-card">
                        <img
                            v-if="effectivePhase === 'reveal'"
                            src="/images/main/small_LOGO.png"
                            alt=""
                        />
                        <span v-else class="ritual-output-mark">✦</span>
                        <strong>{{ t('workspace.ritual.foundry.output') }}</strong>
                    </div>
                </div>
            </div>
            <div class="mt-7 grid gap-2 sm:grid-cols-5">
                <div
                    v-for="(dimension, index) in dimensions"
                    :key="dimension.key"
                    class="ritual-forge-step"
                    :style="{ '--forge-index': index }"
                >
                    <span>{{ String(index + 1).padStart(stepNumberWidth, '0') }}</span>
                    <strong>{{ dimension.label }}</strong>
                </div>
            </div>
            <p class="mt-5 text-center text-sm leading-6 text-muted">
                {{ t(`workspace.ritual.phases.${effectivePhase}.description`) }}
            </p>
        </div>
    </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import type { AnalysisRitualVariant } from './analysis.ritual'

export type AnalysisRitualPhase = 'ignition' | 'forge' | 'reveal'

const props = withDefaults(
    defineProps<{
        phase: AnalysisRitualPhase
        variant: AnalysisRitualVariant
        startedAt?: string | null
        retrying?: boolean
        preview?: boolean
        abandonable?: boolean
        busy?: boolean
    }>(),
    {
        startedAt: null,
        retrying: false,
        preview: false,
        abandonable: false,
        busy: false,
    },
)
const emit = defineEmits<{
    revealed: []
    abandon: []
}>()
const { t } = useI18n()
const now = ref(Date.now())
const previewStartedAt = Date.now()
const previewIgnitionDurationMs = 4_200
const previewForgeDurationMs = 8_400
const previewRevealDurationMs = 5_200
const previewCycleDurationMs =
    previewIgnitionDurationMs + previewForgeDurationMs + previewRevealDurationMs
const revealDurationMs = 4_800
const reducedMotionRevealDurationMs = 160
const clockTickDurationMs = 250
const secondsPerMinute = 60
const millisecondsPerSecond = 1_000
const consciousnessMoteCount = 14
const energyRayCount = 12
const signalBarCount = 24
const forgePlateCount = 5
const stepNumberWidth = 2
let clockTimer: ReturnType<typeof setInterval> | undefined
let revealTimer: ReturnType<typeof setTimeout> | undefined

const effectivePhase = computed<AnalysisRitualPhase>(() => {
    if (!props.preview) {
        return props.phase
    }
    const cycleElapsed = (now.value - previewStartedAt) % previewCycleDurationMs
    if (cycleElapsed < previewIgnitionDurationMs) {
        return 'ignition'
    }
    if (cycleElapsed < previewIgnitionDurationMs + previewForgeDurationMs) {
        return 'forge'
    }
    return 'reveal'
})
const elapsedSeconds = computed(() => {
    if (!props.startedAt) {
        return 0
    }
    return Math.max(
        0,
        Math.floor((now.value - new Date(props.startedAt).getTime()) / millisecondsPerSecond),
    )
})
const elapsedText = computed(() => {
    const minutes = Math.floor(elapsedSeconds.value / secondsPerMinute)
    const seconds = elapsedSeconds.value % secondsPerMinute
    return `${String(minutes).padStart(stepNumberWidth, '0')}:${String(seconds).padStart(stepNumberWidth, '0')}`
})
const coreValue = computed(() => {
    if (effectivePhase.value === 'reveal') {
        return '100%'
    }
    if (effectivePhase.value === 'ignition') {
        return '•'
    }
    return elapsedText.value
})
const coreLabel = computed(() => t(`workspace.ritual.phases.${effectivePhase.value}.core`))
const statusMeta = computed(() => {
    if (props.preview) {
        return t('workspace.ritual.preview')
    }
    if (props.retrying) {
        return t('workspace.ritual.retrying')
    }
    if (effectivePhase.value === 'ignition') {
        return t('workspace.ritual.queuePosition')
    }
    if (effectivePhase.value === 'reveal') {
        return t('workspace.ritual.ready')
    }
    return t('workspace.ritual.running')
})
const dimensions = computed(() => [
    { key: 'intent', label: t('workspace.ritual.dimensions.intent') },
    { key: 'audience', label: t('workspace.ritual.dimensions.audience') },
    { key: 'demand', label: t('workspace.ritual.dimensions.demand') },
    { key: 'novelty', label: t('workspace.ritual.dimensions.novelty') },
    { key: 'expression', label: t('workspace.ritual.dimensions.expression') },
])

/** 完成动效播放后通知工作台揭示真实结果。 */
function scheduleReveal() {
    if (props.preview || effectivePhase.value !== 'reveal') {
        return
    }
    if (revealTimer) {
        clearTimeout(revealTimer)
    }
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    revealTimer = setTimeout(
        () => emit('revealed'),
        reduceMotion ? reducedMotionRevealDurationMs : revealDurationMs,
    )
}

watch(effectivePhase, scheduleReveal, { immediate: true })

onMounted(() => {
    clockTimer = setInterval(() => {
        now.value = Date.now()
    }, clockTickDurationMs)
})

onBeforeUnmount(() => {
    if (clockTimer) {
        clearInterval(clockTimer)
    }
    if (revealTimer) {
        clearTimeout(revealTimer)
    }
})
</script>

<style scoped>
.ritual-shell {
    position: relative;
    color: rgb(var(--color-text));
    background-color: rgb(var(--color-surface));
    background-image:
        radial-gradient(circle at 50% 42%, rgb(var(--color-brand-vivid) / 0.09), transparent 34%),
        linear-gradient(
            145deg,
            rgb(var(--color-surface)),
            rgb(var(--color-surface-muted)) 58%,
            rgb(var(--color-canvas))
        );
    box-shadow: inset 0 1px 0 rgb(var(--color-text) / 0.04);
}

.ritual-grid {
    position: absolute;
    inset: 0;
    opacity: 0.34;
    background-image:
        linear-gradient(rgb(var(--color-text) / 0.035) 1px, transparent 1px),
        linear-gradient(90deg, rgb(var(--color-text) / 0.035) 1px, transparent 1px);
    background-size: 34px 34px;
    mask-image: linear-gradient(to bottom, black, transparent 92%);
}

.ritual-aurora {
    position: absolute;
    width: 15rem;
    height: 15rem;
    border-radius: 9999px;
    filter: blur(70px);
    opacity: 0.12;
}

.ritual-aurora-left {
    left: -5rem;
    top: 22%;
    background: rgb(var(--color-brand-glow));
}

.ritual-aurora-right {
    right: -5rem;
    bottom: 4%;
    background: rgb(var(--color-brand-hot));
}

.ritual-live-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 9999px;
    background: rgb(var(--color-brand-vivid));
    box-shadow: 0 0 0 0 rgb(var(--color-brand-vivid) / 0.45);
    animation: ritual-live 1.8s ease-out infinite;
}

.ritual-a-stage {
    position: relative;
    width: min(100%, 34rem);
    height: 21rem;
    margin: 0 auto;
    isolation: isolate;
}

.ritual-neural-threads {
    position: absolute;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    overflow: visible;
}

.ritual-thread {
    fill: none;
    stroke: rgb(var(--color-brand-glow));
    stroke-width: 1.1;
    stroke-linecap: round;
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    opacity: 0.7;
    animation: ritual-thread-cast 1.4s cubic-bezier(0.18, 0.8, 0.28, 1) forwards;
}

.ritual-thread-audience {
    animation-delay: 90ms;
}
.ritual-thread-demand {
    animation-delay: 180ms;
}
.ritual-thread-novelty {
    animation-delay: 270ms;
}
.ritual-thread-expression {
    animation-delay: 360ms;
}

.ritual-mote-field {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
}

.ritual-mote-field span {
    --mote-x: 0px;
    --mote-y: 0px;
    position: absolute;
    left: 50%;
    top: 50%;
    width: 0.3rem;
    height: 0.3rem;
    margin: -0.15rem 0 0 -0.15rem;
    border-radius: 9999px;
    background: rgb(var(--color-brand-glow));
    box-shadow:
        0 0 5px rgb(var(--color-brand-glow)),
        0 0 13px rgb(var(--color-brand-vivid) / 0.8);
    animation: ritual-mote-cast 1.35s cubic-bezier(0.15, 0.86, 0.25, 1.15) both;
}

.ritual-mote-field span::after {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 0.8rem;
    height: 1px;
    transform: translate(-50%, -50%);
    background: linear-gradient(90deg, transparent, rgb(var(--color-brand-glow)), transparent);
    content: '';
}

.ritual-mote-field span:nth-child(1) {
    --mote-x: -15.5rem;
    --mote-y: -6.8rem;
}
.ritual-mote-field span:nth-child(2) {
    --mote-x: -11.2rem;
    --mote-y: -9rem;
    animation-delay: 70ms;
}
.ritual-mote-field span:nth-child(3) {
    --mote-x: -16.2rem;
    --mote-y: 1.5rem;
    animation-delay: 140ms;
}
.ritual-mote-field span:nth-child(4) {
    --mote-x: -12.8rem;
    --mote-y: 7.1rem;
    animation-delay: 210ms;
}
.ritual-mote-field span:nth-child(5) {
    --mote-x: -6.7rem;
    --mote-y: 9.3rem;
    animation-delay: 280ms;
}
.ritual-mote-field span:nth-child(6) {
    --mote-x: 0.8rem;
    --mote-y: -9.8rem;
    animation-delay: 350ms;
}
.ritual-mote-field span:nth-child(7) {
    --mote-x: 7.6rem;
    --mote-y: -8.8rem;
    animation-delay: 420ms;
}
.ritual-mote-field span:nth-child(8) {
    --mote-x: 13.3rem;
    --mote-y: -6rem;
    animation-delay: 490ms;
}
.ritual-mote-field span:nth-child(9) {
    --mote-x: 15.8rem;
    --mote-y: -0.6rem;
    animation-delay: 560ms;
}
.ritual-mote-field span:nth-child(10) {
    --mote-x: 14.2rem;
    --mote-y: 5.7rem;
    animation-delay: 630ms;
}
.ritual-mote-field span:nth-child(11) {
    --mote-x: 8.9rem;
    --mote-y: 8.8rem;
    animation-delay: 700ms;
}
.ritual-mote-field span:nth-child(12) {
    --mote-x: 2.2rem;
    --mote-y: 9.9rem;
    animation-delay: 770ms;
}
.ritual-mote-field span:nth-child(13) {
    --mote-x: -8.8rem;
    --mote-y: -5.9rem;
    animation-delay: 840ms;
}
.ritual-mote-field span:nth-child(14) {
    --mote-x: 10.7rem;
    --mote-y: 2.7rem;
    animation-delay: 910ms;
}

.ritual-core {
    position: absolute;
    left: 50%;
    top: 50%;
    z-index: 5;
    display: flex;
    width: 11rem;
    height: 11rem;
    transform: translate(-50%, -50%);
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    perspective: 700px;
    animation: ritual-core-awaken 1.5s cubic-bezier(0.18, 0.8, 0.24, 1.1) both;
}

.ritual-core-glow {
    position: absolute;
    inset: 12%;
    border-radius: 9999px;
    background: radial-gradient(
        circle,
        rgb(var(--color-brand-glow) / 0.24),
        rgb(var(--color-brand-vivid) / 0.1) 38%,
        transparent 70%
    );
    filter: blur(20px);
    animation: ritual-sphere-glow 2.1s ease-in-out infinite alternate;
}

.ritual-digital-sphere {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    filter: drop-shadow(0 0 10px rgb(var(--color-brand-vivid) / 0.42))
        drop-shadow(0 0 28px rgb(var(--color-brand-glow) / 0.12));
    transform: rotateX(-8deg) rotateY(10deg);
    transform-style: preserve-3d;
}

.ritual-sphere-wireframe {
    stroke-width: 0.75;
    stroke-opacity: 0.55;
    stroke-dasharray: 5 5;
    transform-origin: center;
    animation: ritual-sphere-data 8s linear infinite;
}

.ritual-sphere-nodes {
    filter: drop-shadow(0 0 4px rgb(var(--color-brand-glow)));
    animation: ritual-sphere-nodes 1.7s ease-in-out infinite alternate;
}

.ritual-sphere-highlight {
    filter: blur(0.35px);
}

.ritual-sphere-equator {
    position: absolute;
    left: 2%;
    top: 50%;
    width: 96%;
    height: 34%;
    transform: translateY(-50%) rotate(-7deg);
    border: 1px solid rgb(var(--color-brand-glow) / 0.28);
    border-radius: 9999px;
    box-shadow: 0 0 12px rgb(var(--color-brand-vivid) / 0.12);
    animation: ritual-equator 4.5s ease-in-out infinite alternate;
}

.ritual-flame {
    position: relative;
    z-index: 4;
    width: 2.45rem;
    height: 3.15rem;
    transform-origin: center bottom;
    filter: drop-shadow(0 0 14px rgb(var(--color-brand-vivid) / 0.62));
    animation: ritual-flame 0.92s ease-in-out infinite alternate;
}

.ritual-logo {
    position: absolute;
    z-index: 6;
    width: 5rem;
    height: 5rem;
    object-fit: contain;
    opacity: 0;
    filter: drop-shadow(0 0 8px rgb(var(--color-brand-glow)))
        drop-shadow(0 0 24px rgb(var(--color-brand-vivid) / 0.92));
}

.ritual-logo-halo {
    position: absolute;
    z-index: 3;
    width: 1rem;
    height: 1rem;
    border-radius: 9999px;
    background: rgb(var(--color-surface));
    box-shadow:
        0 0 18px 8px rgb(var(--color-brand-glow) / 0.9),
        0 0 48px 24px rgb(var(--color-brand-vivid) / 0.45),
        0 0 88px 42px rgb(var(--color-brand-glow) / 0.16);
    opacity: 0;
}

.ritual-energy-burst {
    position: absolute;
    inset: -55%;
    z-index: 2;
    pointer-events: none;
}

.ritual-energy-burst span {
    position: absolute;
    left: 50%;
    bottom: 50%;
    width: 1px;
    height: 50%;
    transform-origin: 50% 100%;
    background: linear-gradient(to top, rgb(var(--color-brand-glow)), transparent 78%);
    opacity: 0;
}

.ritual-energy-burst span:nth-child(1) {
    transform: rotate(0deg);
}
.ritual-energy-burst span:nth-child(2) {
    transform: rotate(30deg);
}
.ritual-energy-burst span:nth-child(3) {
    transform: rotate(60deg);
}
.ritual-energy-burst span:nth-child(4) {
    transform: rotate(90deg);
}
.ritual-energy-burst span:nth-child(5) {
    transform: rotate(120deg);
}
.ritual-energy-burst span:nth-child(6) {
    transform: rotate(150deg);
}
.ritual-energy-burst span:nth-child(7) {
    transform: rotate(180deg);
}
.ritual-energy-burst span:nth-child(8) {
    transform: rotate(210deg);
}
.ritual-energy-burst span:nth-child(9) {
    transform: rotate(240deg);
}
.ritual-energy-burst span:nth-child(10) {
    transform: rotate(270deg);
}
.ritual-energy-burst span:nth-child(11) {
    transform: rotate(300deg);
}
.ritual-energy-burst span:nth-child(12) {
    transform: rotate(330deg);
}

.ritual-core-value,
.ritual-core-label {
    z-index: 4;
}

.ritual-core-value {
    margin-top: 0.35rem;
    font-size: 1rem;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.04em;
}

.ritual-core-label {
    margin-top: 0.1rem;
    font-size: 0.625rem;
    color: rgb(var(--color-text-muted));
}

.ritual-dimension-anchor {
    --dimension-x: 0px;
    --dimension-y: 0px;
    position: absolute;
    left: 50%;
    top: 50%;
    z-index: 4;
    animation: ritual-dimension-cast 1.45s cubic-bezier(0.15, 0.86, 0.25, 1.15) both;
}

.ritual-dimension {
    display: inline-flex;
    transform: translate(-50%, -50%);
    align-items: center;
    gap: 0.4rem;
    border: 1px solid rgb(var(--color-border));
    border-radius: 9999px;
    background: rgb(var(--color-surface) / 0.82);
    padding: 0.42rem 0.72rem;
    font-size: 0.625rem;
    color: rgb(var(--color-text));
    box-shadow:
        0 0 0 1px rgb(var(--color-brand-glow) / 0.03),
        0 8px 20px rgb(var(--color-text) / 0.12);
    white-space: nowrap;
    backdrop-filter: blur(12px);
}

.ritual-dimension i {
    width: 0.3rem;
    height: 0.3rem;
    border-radius: 9999px;
    background: rgb(var(--color-brand-glow));
    box-shadow: 0 0 9px rgb(var(--color-brand-glow));
}

.ritual-dimension-anchor-intent {
    --dimension-x: -12.4rem;
    --dimension-y: -6rem;
}
.ritual-dimension-anchor-audience {
    --dimension-x: 12.7rem;
    --dimension-y: -5.2rem;
    animation-delay: 100ms;
}
.ritual-dimension-anchor-demand {
    --dimension-x: -13rem;
    --dimension-y: 6rem;
    animation-delay: 200ms;
}
.ritual-dimension-anchor-novelty {
    --dimension-x: 13rem;
    --dimension-y: 5.2rem;
    animation-delay: 300ms;
}
.ritual-dimension-anchor-expression {
    --dimension-x: 0rem;
    --dimension-y: 9rem;
    animation-delay: 400ms;
}

.ritual-forge.ritual-variant-a .ritual-core {
    animation: ritual-core-breathe 2.15s ease-in-out infinite alternate;
}

.ritual-forge.ritual-variant-a .ritual-thread {
    stroke-dashoffset: 0;
    animation: ritual-thread-consciousness 2.4s ease-in-out infinite alternate;
}

.ritual-forge.ritual-variant-a .ritual-dimension {
    animation: ritual-dimension-float 2.7s ease-in-out infinite alternate;
}

.ritual-forge.ritual-variant-a .ritual-dimension-anchor-audience .ritual-dimension,
.ritual-forge.ritual-variant-a .ritual-dimension-anchor-demand .ritual-dimension {
    animation-delay: -1.1s;
}

.ritual-forge.ritual-variant-a .ritual-dimension-anchor-novelty .ritual-dimension,
.ritual-forge.ritual-variant-a .ritual-dimension-anchor-expression .ritual-dimension {
    animation-delay: -1.9s;
}

.ritual-forge.ritual-variant-a .ritual-mote-field span {
    animation:
        ritual-mote-cast 0.8s cubic-bezier(0.15, 0.86, 0.25, 1.15) both,
        ritual-mote-drift 3.2s 0.8s ease-in-out infinite alternate;
}

.ritual-b-stage {
    position: relative;
    height: 18.75rem;
    max-width: 45rem;
    margin: 0 auto;
}

.ritual-constellation-lines {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    fill: none;
    stroke: rgb(var(--color-brand-vivid) / 0.22);
    stroke-width: 1;
    stroke-dasharray: 5 8;
    animation: ritual-dash 3s linear infinite;
}

.ritual-b-core {
    position: absolute;
    left: 50%;
    top: 50%;
    z-index: 3;
    display: flex;
    width: 9rem;
    height: 9rem;
    transform: translate(-50%, -50%);
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border: 1px solid rgb(var(--color-brand-vivid) / 0.4);
    border-radius: 2.5rem;
    background: rgb(var(--color-surface) / 0.92);
    box-shadow: 0 0 70px rgb(var(--color-brand-vivid) / 0.18);
}

.ritual-b-core img {
    width: 2.8rem;
    height: 2.8rem;
    object-fit: contain;
}

.ritual-b-core strong {
    margin-top: 0.4rem;
    font-variant-numeric: tabular-nums;
}
.ritual-b-core small {
    color: rgb(var(--color-text-muted));
}
.ritual-b-spark {
    font-size: 2.4rem;
    color: rgb(var(--color-brand-glow));
    animation: ritual-breathe 1.5s ease-in-out infinite;
}

.ritual-node {
    position: absolute;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    border: 1px solid rgb(var(--color-border));
    border-radius: 0.8rem;
    background: rgb(var(--color-surface) / 0.72);
    padding: 0.55rem 0.75rem;
    font-size: 0.6875rem;
    color: rgb(var(--color-text));
}

.ritual-node i {
    width: 0.38rem;
    height: 0.38rem;
    border-radius: 9999px;
    background: rgb(var(--color-brand-glow));
    box-shadow: 0 0 10px rgb(var(--color-brand-glow));
    animation: ritual-node 1.6s ease-in-out infinite alternate;
}

.ritual-node-intent {
    left: 3%;
    top: 12%;
}
.ritual-node-audience {
    left: 7%;
    bottom: 12%;
}
.ritual-node-demand {
    left: 50%;
    top: 0;
    transform: translateX(-50%);
}
.ritual-node-novelty {
    right: 3%;
    top: 10%;
}
.ritual-node-expression {
    right: 5%;
    bottom: 12%;
}

.ritual-signal-strip {
    display: flex;
    height: 1.8rem;
    max-width: 34rem;
    margin: 0 auto;
    align-items: center;
    justify-content: center;
    gap: 0.2rem;
}

.ritual-signal-strip span {
    width: 0.18rem;
    height: calc(0.3rem + (var(--signal-index) % 5) * 0.18rem);
    border-radius: 9999px;
    background: rgb(var(--color-brand-vivid) / 0.65);
    animation: ritual-signal 1.2s ease-in-out infinite alternate;
    animation-delay: calc(var(--signal-index) * -45ms);
}

.ritual-c-stage {
    display: grid;
    min-height: 14rem;
    max-width: 48rem;
    margin: 0 auto;
    grid-template-columns: 7rem minmax(8rem, 1fr) 9rem;
    align-items: center;
}

.ritual-c-source,
.ritual-c-output {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    color: rgb(var(--color-text-muted));
}

.ritual-c-source-fire {
    display: flex;
    width: 4.5rem;
    height: 4.5rem;
    align-items: center;
    justify-content: center;
    border: 1px solid rgb(var(--color-brand-vivid) / 0.35);
    border-radius: 1.5rem;
    background: rgb(var(--color-brand-vivid) / 0.08);
    font-size: 2rem;
    filter: drop-shadow(0 0 14px rgb(var(--color-brand-vivid) / 0.42));
    animation: ritual-flame 1.25s ease-in-out infinite alternate;
}

.ritual-c-source small {
    margin-top: 0.65rem;
}

.ritual-c-track {
    position: relative;
    height: 5rem;
    overflow: hidden;
    border-top: 1px solid rgb(var(--color-border));
    border-bottom: 1px solid rgb(var(--color-border));
    background: linear-gradient(
        90deg,
        rgb(var(--color-brand-vivid) / 0.07),
        rgb(var(--color-brand-hot) / 0.08)
    );
}

.ritual-c-track::after {
    position: absolute;
    inset: 0;
    content: '';
    background: repeating-linear-gradient(
        90deg,
        transparent 0 2.5rem,
        rgb(var(--color-text) / 0.04) 2.5rem 2.6rem
    );
    animation: ritual-track 2s linear infinite;
}

.ritual-c-track span {
    position: absolute;
    left: -3rem;
    top: 50%;
    width: 2.2rem;
    height: 1.3rem;
    transform: translateY(-50%) rotate(45deg);
    border: 1px solid rgb(var(--color-brand-glow) / 0.5);
    border-radius: 0.35rem;
    background: rgb(var(--color-brand-vivid) / 0.18);
    box-shadow: 0 0 18px rgb(var(--color-brand-vivid) / 0.18);
    animation: ritual-plate 4s linear infinite;
}

.ritual-c-track span:nth-child(2) {
    animation-delay: -0.8s;
}
.ritual-c-track span:nth-child(3) {
    animation-delay: -1.6s;
}
.ritual-c-track span:nth-child(4) {
    animation-delay: -2.4s;
}
.ritual-c-track span:nth-child(5) {
    animation-delay: -3.2s;
}

.ritual-output-card {
    display: flex;
    width: 7rem;
    height: 8rem;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    border: 1px solid rgb(var(--color-brand-vivid) / 0.32);
    border-radius: 1.25rem;
    background: rgb(var(--color-surface) / 0.72);
    font-size: 0.7rem;
    box-shadow: 0 0 40px rgb(var(--color-brand-vivid) / 0.08);
}

.ritual-output-card img {
    width: 3.2rem;
    height: 3.2rem;
    object-fit: contain;
    animation: ritual-logo-in 0.7s ease-out both;
}
.ritual-output-mark {
    font-size: 2rem;
    color: rgb(var(--color-brand-glow));
    animation: ritual-breathe 1.5s ease-in-out infinite;
}

.ritual-forge-step {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.5rem;
    border: 1px solid rgb(var(--color-border));
    border-radius: 0.75rem;
    background: rgb(var(--color-surface) / 0.72);
    padding: 0.55rem 0.65rem;
    animation: ritual-step 2.4s ease-in-out infinite;
    animation-delay: calc(var(--forge-index) * 180ms);
}

.ritual-forge-step span {
    font-size: 0.58rem;
    color: rgb(var(--color-brand-glow));
}
.ritual-forge-step strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.625rem;
    color: rgb(var(--color-text-muted));
}

.ritual-ignition .ritual-constellation-lines,
.ritual-ignition .ritual-c-track span {
    animation-duration: 6s;
    opacity: 0.48;
}

.ritual-reveal .ritual-b-core,
.ritual-reveal .ritual-output-card {
    border-color: rgb(var(--color-brand-glow) / 0.7);
    box-shadow: 0 0 90px rgb(var(--color-brand-vivid) / 0.3);
    animation: ritual-finish 1.1s cubic-bezier(0.2, 0.9, 0.25, 1) both;
}

.ritual-reveal.ritual-variant-a .ritual-dimension-anchor {
    animation: ritual-dimension-recall 1.25s cubic-bezier(0.72, 0, 0.9, 0.42) both;
    animation-delay: 0s;
}

.ritual-reveal.ritual-variant-a .ritual-thread {
    stroke-dashoffset: 0;
    animation: ritual-thread-recall 1.35s ease-in both;
    animation-delay: 0s;
}

.ritual-reveal.ritual-variant-a .ritual-mote-field span {
    animation: ritual-mote-recall 1.2s cubic-bezier(0.72, 0, 0.9, 0.42) both;
    animation-delay: 0s;
}

.ritual-reveal.ritual-variant-a .ritual-core {
    animation: ritual-core-eruption 4.6s cubic-bezier(0.25, 0.8, 0.25, 1) both;
}

.ritual-reveal.ritual-variant-a .ritual-digital-sphere {
    animation: ritual-sphere-collapse 3.05s ease-in both;
}

.ritual-reveal.ritual-variant-a .ritual-sphere-equator {
    animation: ritual-equator-collapse 3.05s ease-in both;
}

.ritual-reveal.ritual-variant-a .ritual-core-glow {
    animation: ritual-glow-charge 3.35s ease-in-out both;
}

.ritual-reveal.ritual-variant-a .ritual-flame {
    animation: ritual-flame-charge 3.2s cubic-bezier(0.34, 0.02, 0.25, 1) both;
}

.ritual-reveal.ritual-variant-a .ritual-logo {
    animation: ritual-logo-transmute 1.65s 2.55s cubic-bezier(0.16, 0.88, 0.24, 1.18) both;
}

.ritual-reveal.ritual-variant-a .ritual-logo-halo {
    animation: ritual-halo-bloom 2s 2.45s ease-out both;
}

.ritual-reveal.ritual-variant-a .ritual-energy-burst span {
    animation: ritual-energy-ray 1.55s 2.35s ease-out both;
}

.ritual-reveal.ritual-variant-a .ritual-core-value,
.ritual-reveal.ritual-variant-a .ritual-core-label {
    animation: ritual-core-copy-out 0.45s ease-in both;
}

@keyframes ritual-live {
    70% {
        box-shadow: 0 0 0 0.45rem transparent;
    }
    100% {
        box-shadow: 0 0 0 0 transparent;
    }
}

@keyframes ritual-breathe {
    from {
        transform: scale(0.78);
        opacity: 0.48;
    }
    to {
        transform: scale(1.15);
        opacity: 1;
    }
}

@keyframes ritual-flame {
    from {
        transform: scale(0.94) rotate(-2deg);
    }
    to {
        transform: scale(1.06) rotate(2deg);
    }
}

@keyframes ritual-thread-cast {
    0% {
        stroke-dashoffset: 1;
        opacity: 0;
    }
    28% {
        opacity: 0.85;
    }
    100% {
        stroke-dashoffset: 0;
        opacity: 0.68;
    }
}

@keyframes ritual-thread-consciousness {
    from {
        stroke-width: 0.75;
        opacity: 0.28;
        filter: saturate(0.8);
    }
    to {
        stroke-width: 1.65;
        opacity: 0.92;
        filter: saturate(1.35);
    }
}

@keyframes ritual-thread-recall {
    0% {
        stroke-dashoffset: 0;
        opacity: 0.8;
    }
    100% {
        stroke-dashoffset: -1;
        opacity: 0;
    }
}

@keyframes ritual-mote-cast {
    0% {
        transform: translate(0, 0) scale(0);
        opacity: 0;
    }
    22% {
        opacity: 1;
    }
    72% {
        transform: translate(var(--mote-x), var(--mote-y)) scale(1.35);
    }
    100% {
        transform: translate(var(--mote-x), var(--mote-y)) scale(1);
        opacity: 0.95;
    }
}

@keyframes ritual-mote-drift {
    from {
        transform: translate(var(--mote-x), var(--mote-y)) scale(0.78);
        opacity: 0.48;
    }
    to {
        transform: translate(calc(var(--mote-x) + 5px), calc(var(--mote-y) - 7px)) scale(1.35);
        opacity: 1;
    }
}

@keyframes ritual-mote-recall {
    0% {
        transform: translate(var(--mote-x), var(--mote-y)) scale(1);
        opacity: 0.95;
    }
    72% {
        opacity: 1;
    }
    100% {
        transform: translate(0, 0) scale(0);
        opacity: 0;
    }
}

@keyframes ritual-dimension-cast {
    0% {
        transform: translate(0, 0) scale(0) rotate(-18deg);
        opacity: 0;
    }
    38% {
        opacity: 1;
    }
    74% {
        transform: translate(var(--dimension-x), var(--dimension-y)) scale(1.08) rotate(3deg);
    }
    100% {
        transform: translate(var(--dimension-x), var(--dimension-y)) scale(1) rotate(0);
        opacity: 1;
    }
}

@keyframes ritual-dimension-float {
    from {
        transform: translate(-50%, calc(-50% - 3px)) rotate(-1.5deg);
    }
    to {
        transform: translate(-50%, calc(-50% + 5px)) rotate(1.5deg);
    }
}

@keyframes ritual-dimension-recall {
    0% {
        transform: translate(var(--dimension-x), var(--dimension-y)) scale(1);
        opacity: 1;
        filter: blur(0);
    }
    68% {
        opacity: 1;
    }
    100% {
        transform: translate(0, 0) scale(0.12) rotate(22deg);
        opacity: 0;
        filter: blur(2px);
    }
}

@keyframes ritual-core-awaken {
    0% {
        transform: translate(-50%, -50%) scale(0.58);
        opacity: 0;
        filter: brightness(2.2);
    }
    62% {
        transform: translate(-50%, -50%) scale(1.08);
        opacity: 1;
    }
    100% {
        transform: translate(-50%, -50%) scale(1);
        opacity: 1;
        filter: brightness(1);
    }
}

@keyframes ritual-core-breathe {
    from {
        transform: translate(-50%, -50%) scale(0.94);
        filter: brightness(0.9);
    }
    to {
        transform: translate(-50%, -50%) scale(1.07);
        filter: brightness(1.18) drop-shadow(0 0 24px rgb(var(--color-brand-vivid) / 0.45));
    }
}

@keyframes ritual-sphere-glow {
    from {
        transform: scale(0.78);
        opacity: 0.38;
    }
    to {
        transform: scale(1.24);
        opacity: 1;
    }
}

@keyframes ritual-sphere-data {
    to {
        transform: rotate(360deg);
        stroke-dashoffset: -30;
    }
}

@keyframes ritual-sphere-nodes {
    from {
        opacity: 0.38;
    }
    to {
        opacity: 1;
    }
}

@keyframes ritual-equator {
    from {
        transform: translateY(-50%) rotate(-10deg) scaleX(0.92);
        opacity: 0.35;
    }
    to {
        transform: translateY(-50%) rotate(8deg) scaleX(1.08);
        opacity: 0.82;
    }
}

@keyframes ritual-core-eruption {
    0% {
        transform: translate(-50%, -50%) scale(1);
    }
    28% {
        transform: translate(-50%, -50%) scale(0.9);
    }
    47% {
        transform: translate(-50%, -50%) scale(0.68);
        filter: brightness(1.7);
    }
    61% {
        transform: translate(-50%, -50%) scale(1.23);
        filter: brightness(2.1);
    }
    76% {
        transform: translate(-50%, -50%) scale(0.98);
        filter: brightness(1.3);
    }
    100% {
        transform: translate(-50%, -50%) scale(1);
        filter: brightness(1);
    }
}

@keyframes ritual-sphere-collapse {
    0%,
    38% {
        transform: rotateX(-8deg) rotateY(10deg) scale(1);
        opacity: 1;
        filter: brightness(1);
    }
    55% {
        transform: rotateX(-8deg) rotateY(10deg) scale(0.48);
        opacity: 0.9;
        filter: brightness(2);
    }
    75%,
    100% {
        transform: rotateX(-8deg) rotateY(10deg) scale(1.42);
        opacity: 0;
        filter: brightness(2.8);
    }
}

@keyframes ritual-equator-collapse {
    0%,
    38% {
        transform: translateY(-50%) rotate(-7deg) scale(1);
        opacity: 0.72;
    }
    55% {
        transform: translateY(-50%) rotate(12deg) scale(0.48);
        opacity: 0.9;
    }
    75%,
    100% {
        transform: translateY(-50%) rotate(28deg) scale(1.42);
        opacity: 0;
    }
}

@keyframes ritual-glow-charge {
    0% {
        transform: scale(1);
        opacity: 0.5;
    }
    48% {
        transform: scale(0.42);
        opacity: 1;
    }
    68% {
        transform: scale(1.9);
        opacity: 1;
    }
    100% {
        transform: scale(1.35);
        opacity: 0.72;
    }
}

@keyframes ritual-flame-charge {
    0% {
        transform: scale(1);
        opacity: 1;
    }
    38% {
        transform: scale(1.22) translateY(-2px);
        opacity: 1;
    }
    55% {
        transform: scale(0.45) translateY(5px);
        opacity: 1;
        filter: brightness(2.4);
    }
    72% {
        transform: scale(3.4) translateY(-5px);
        opacity: 0;
        filter: brightness(3);
    }
    100% {
        transform: scale(4.2) translateY(-7px);
        opacity: 0;
    }
}

@keyframes ritual-logo-transmute {
    0% {
        transform: scale(0.2) rotate(-24deg);
        opacity: 0;
        filter: brightness(3) blur(3px);
    }
    48% {
        transform: scale(1.22) rotate(5deg);
        opacity: 1;
        filter: brightness(1.8) blur(0);
    }
    72% {
        transform: scale(0.94) rotate(-2deg);
        opacity: 1;
    }
    100% {
        transform: scale(1) rotate(0);
        opacity: 1;
    }
}

@keyframes ritual-halo-bloom {
    0% {
        transform: scale(0.2);
        opacity: 0;
    }
    28% {
        transform: scale(1.5);
        opacity: 1;
    }
    100% {
        transform: scale(1);
        opacity: 0.68;
    }
}

@keyframes ritual-energy-ray {
    0% {
        opacity: 0;
        height: 5%;
    }
    30% {
        opacity: 0.95;
        height: 58%;
    }
    100% {
        opacity: 0;
        height: 78%;
    }
}

@keyframes ritual-core-copy-out {
    to {
        transform: translateY(6px) scale(0.8);
        opacity: 0;
    }
}

@keyframes ritual-logo-in {
    from {
        transform: scale(0.45) rotate(-18deg);
        opacity: 0;
    }
    to {
        transform: scale(1) rotate(0);
        opacity: 1;
    }
}

@keyframes ritual-orbit {
    to {
        transform: translate(-50%, -50%) rotate(360deg);
    }
}

@keyframes ritual-orbit-reverse {
    to {
        transform: translate(-50%, -50%) rotate(-360deg);
    }
}

@keyframes ritual-dash {
    to {
        stroke-dashoffset: -26;
    }
}

@keyframes ritual-node {
    from {
        opacity: 0.35;
        transform: scale(0.78);
    }
    to {
        opacity: 1;
        transform: scale(1.12);
    }
}

@keyframes ritual-signal {
    from {
        transform: scaleY(0.4);
        opacity: 0.35;
    }
    to {
        transform: scaleY(1);
        opacity: 1;
    }
}

@keyframes ritual-track {
    to {
        transform: translateX(2.6rem);
    }
}

@keyframes ritual-plate {
    to {
        left: calc(100% + 3rem);
        transform: translateY(-50%) rotate(405deg);
    }
}

@keyframes ritual-step {
    0%,
    100% {
        border-color: rgb(var(--color-border));
        background: rgb(var(--color-surface) / 0.72);
    }
    50% {
        border-color: rgb(var(--color-brand-vivid) / 0.36);
        background: rgb(var(--color-brand-vivid) / 0.08);
    }
}

@keyframes ritual-finish {
    0% {
        transform: translate(-50%, -50%) scale(0.92);
    }
    42% {
        transform: translate(-50%, -50%) scale(1.1);
    }
    100% {
        transform: translate(-50%, -50%) scale(1);
    }
}

.ritual-variant-c.ritual-reveal .ritual-output-card {
    animation-name: ritual-finish-static;
}

@keyframes ritual-finish-static {
    0% {
        transform: scale(0.92);
    }
    42% {
        transform: scale(1.1);
    }
    100% {
        transform: scale(1);
    }
}

@media (max-width: 640px) {
    .ritual-a-stage {
        height: 18rem;
    }
    .ritual-core {
        width: 9rem;
        height: 9rem;
    }
    .ritual-dimension-anchor-intent {
        --dimension-x: -8rem;
        --dimension-y: -5.2rem;
    }
    .ritual-dimension-anchor-audience {
        --dimension-x: 8rem;
        --dimension-y: -4.6rem;
    }
    .ritual-dimension-anchor-demand {
        --dimension-x: -8.2rem;
        --dimension-y: 5.1rem;
    }
    .ritual-dimension-anchor-novelty {
        --dimension-x: 8.2rem;
        --dimension-y: 4.8rem;
    }
    .ritual-dimension-anchor-expression {
        --dimension-y: 7.5rem;
    }
    .ritual-b-stage {
        height: 17rem;
    }
    .ritual-node-intent {
        left: 0;
    }
    .ritual-node-audience {
        left: 0;
    }
    .ritual-node-novelty {
        right: 0;
    }
    .ritual-node-expression {
        right: 0;
    }
    .ritual-c-stage {
        grid-template-columns: 5rem minmax(5rem, 1fr) 6rem;
    }
    .ritual-c-source-fire {
        width: 3.5rem;
        height: 3.5rem;
    }
    .ritual-output-card {
        width: 5.5rem;
        height: 7rem;
    }
}
</style>
