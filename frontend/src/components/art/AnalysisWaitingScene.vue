<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIllustrationMotion } from '@/composables/useIllustrationMotion'
import type { AnalysisRitualVariant } from '@/features/analysis/analysis.ritual'

const props = defineProps<{ variant: AnalysisRitualVariant | 'loading' }>()
const { t } = useI18n()
const scene = ref<HTMLElement | null>(null)
const { phase, isReady, isMoving, isReduced } = useIllustrationMotion(scene, () => true)
const character = computed(
    () =>
        ({
            A: 'ritual-orbit',
            B: 'ritual-cinema',
            C: 'ritual-bindery',
            loading: 'loading-creator',
        })[props.variant],
)
const dimensions = ['intent', 'audience', 'demand', 'novelty', 'expression'] as const
const notes = ['landscape', 'coffee', 'plant'] as const
</script>

<template>
    <div
        ref="scene"
        class="waiting-scene"
        :class="`waiting-scene--${variant}`"
        :data-phase="phase"
        :data-ready="isReady"
        :data-moving="isMoving"
        :data-reduced="isReduced"
        data-testid="analysis-waiting-scene"
        aria-hidden="true"
    >
        <div class="waiting-artboard">
            <div class="waiting-halo art-enter" data-entry-y="0"></div>
            <div
                v-if="variant === 'loading' || variant === 'A'"
                class="waiting-orbits art-enter"
                data-entry-y="0"
            >
                <i class="waiting-orbit"></i><i class="waiting-orbit waiting-orbit--cross"></i>
                <i class="waiting-orbit waiting-orbit--round"></i>
            </div>
            <div v-if="variant === 'B'" class="waiting-beam art-enter" data-entry-y="0">
                <i></i>
            </div>
            <template v-if="variant === 'loading'">
                <div
                    v-for="(note, index) in notes"
                    :key="note"
                    class="waiting-note art-enter"
                    :class="`waiting-note--${index + 1}`"
                    :data-entry-delay="120 + index * 100"
                >
                    <img
                        :src="`/images/art/loading-note-${note}.webp`"
                        alt=""
                        width="102"
                        height="149"
                        draggable="false"
                    />
                </div>
                <div class="waiting-companion art-enter" data-entry-delay="400">
                    <img
                        src="/images/art/loading-mascot.webp"
                        alt=""
                        width="411"
                        height="540"
                        draggable="false"
                    />
                </div>
            </template>
            <template v-else>
                <div
                    v-for="sheet in 3"
                    :key="sheet"
                    class="waiting-sheet-entry art-enter"
                    :class="`waiting-sheet-entry--${sheet}`"
                    :data-entry-delay="sheet * 120"
                >
                    <div class="waiting-sheet"><b></b><i></i><i></i><i></i></div>
                </div>
                <div v-if="variant === 'B'" class="waiting-scan"></div>
            </template>
            <div class="waiting-ground art-enter" data-entry-y="0"></div>
            <div class="waiting-character art-enter" data-entry-delay="180">
                <img
                    :src="`/images/art/${character}.webp`"
                    alt=""
                    :width="variant === 'loading' ? 848 : 422"
                    :height="variant === 'loading' ? 1000 : 445"
                    draggable="false"
                />
            </div>
            <span
                v-for="spark in 4"
                :key="spark"
                class="waiting-spark"
                :class="`waiting-spark--${spark}`"
            >✦</span
            >
        </div>
        <div v-if="variant !== 'loading'" class="waiting-tags">
            <span
                v-for="dimension in dimensions"
                :key="dimension"
                class="waiting-tag art-enter"
                :class="`waiting-tag--${dimension}`"
                data-entry-y="8"
            >
                {{ t(`workspace.ritual.dimensions.${dimension}`) }}
            </span>
        </div>
    </div>
</template>

<style scoped src="./analysis-waiting-scene.css"></style>
