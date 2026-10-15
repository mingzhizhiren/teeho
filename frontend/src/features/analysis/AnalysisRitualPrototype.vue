<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/AppButton.vue'
import AnalysisWaitingScene from '@/components/art/AnalysisWaitingScene.vue'
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
    { startedAt: null, retrying: false, preview: false, abandonable: false, busy: false },
)
const emit = defineEmits<{ revealed: []; abandon: [] }>()
const { t } = useI18n()
const now = ref(Date.now())
const CLOCK_INTERVAL_MS = 1000
const SECONDS_PER_MINUTE = 60
const CLOCK_DIGITS = 2
let clockTimer: ReturnType<typeof setInterval> | undefined
const elapsedText = computed(() => {
    const started = props.startedAt ? Date.parse(props.startedAt) : NaN
    if (!Number.isFinite(started)) return null
    const elapsed = Math.max(0, Math.floor((now.value - started) / CLOCK_INTERVAL_MS))
    return `${String(Math.floor(elapsed / SECONDS_PER_MINUTE)).padStart(CLOCK_DIGITS, '0')}:${String(elapsed % SECONDS_PER_MINUTE).padStart(CLOCK_DIGITS, '0')}`
})
const statusMeta = computed(() => {
    if (props.preview) return t('workspace.ritual.preview')
    if (props.retrying) return t('workspace.ritual.retrying')
    if (props.phase === 'ignition') return t('workspace.ritual.queuePosition')
    if (props.phase === 'reveal') return t('workspace.ritual.ready')
    return t('workspace.ritual.running')
})

/** 只响应服务端完成状态，不让装饰动画延迟真实报告。 */
function revealResult(): void {
    if (!props.preview && props.phase === 'reveal') emit('revealed')
}
function syncClock(): void {
    clearInterval(clockTimer)
    clockTimer = undefined
    if (document.hidden) return
    now.value = Date.now()
    if (!props.preview && props.phase === 'forge' && props.startedAt) {
        clockTimer = setInterval(() => {
            now.value = Date.now()
        }, CLOCK_INTERVAL_MS)
    }
}
watch(() => props.phase, revealResult, { flush: 'post' })
watch(
    () => [props.phase, props.startedAt, props.preview],
    () => {
        if (typeof document !== 'undefined') syncClock()
    },
)
onMounted(() => {
    syncClock()
    revealResult()
    document.addEventListener('visibilitychange', syncClock)
})
onBeforeUnmount(() => {
    clearInterval(clockTimer)
    document.removeEventListener('visibilitychange', syncClock)
})
</script>

<template>
    <section
        class="ritual-shell mt-7 overflow-hidden rounded-3xl border border-line bg-surface text-ink"
        :data-ritual-variant="variant"
    >
        <header class="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-7 sm:pt-7">
            <div role="status" aria-live="polite">
                <p class="text-xs font-semibold tracking-widest text-brand">
                    {{ t('workspace.ritual.eyebrow') }}
                </p>
                <h2 class="mt-2 text-sm font-semibold sm:text-base">
                    {{ t(`workspace.ritual.phases.${phase}.title`) }}
                </h2>
                <p class="mt-2 text-xs text-muted">{{ statusMeta }}</p>
            </div>
            <AppButton
                v-if="abandonable && !preview"
                variant="danger"
                size="md"
                type="button"
                :disabled="busy"
                @click="emit('abandon')"
            >
                {{ t('workspace.abandonTask') }}
            </AppButton>
        </header>
        <div class="px-3 pb-6 pt-6 sm:px-7 sm:pb-8">
            <AnalysisWaitingScene :key="variant" :variant="variant" />
            <p
                v-if="phase === 'forge' && !preview && elapsedText"
                class="mt-7 text-center text-xs tabular-nums text-muted"
                data-testid="analysis-elapsed"
            >
                {{ t('workspace.ritual.phases.forge.core') }} · {{ elapsedText }}
            </p>
            <p class="mt-7 text-center text-sm text-muted">
                {{ t(`workspace.ritual.captions.${variant}`) }}
            </p>
        </div>
    </section>
</template>
