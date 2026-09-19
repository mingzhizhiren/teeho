<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import ToastMessage from '@/components/ToastMessage.vue'
import { analysisUiConstraints } from './analysis.constants'
import type { AnalysisContentKind } from './taskDraft'

const props = withDefaults(
    defineProps<{
        modelValue: AnalysisContentKind
        videoEnabled: boolean
        videoUnavailableMessage?: string
        disabled?: boolean
        embedded?: boolean
    }>(),
    { disabled: false, embedded: false, videoUnavailableMessage: '' },
)
const emit = defineEmits<{
    'update:modelValue': [kind: AnalysisContentKind]
}>()
const { t } = useI18n()
const kinds = ['image', 'video'] as const
const unavailableToastVisible = ref(false)
let unavailableToastTimer: number | null = null

function selectContentKind(kind: AnalysisContentKind) {
    if (kind === 'video' && !props.videoEnabled) {
        unavailableToastVisible.value = true
        if (unavailableToastTimer !== null) window.clearTimeout(unavailableToastTimer)
        unavailableToastTimer = window.setTimeout(() => {
            unavailableToastVisible.value = false
            unavailableToastTimer = null
        }, analysisUiConstraints.actionToastDurationMs)
        return
    }
    emit('update:modelValue', kind)
}

onBeforeUnmount(() => {
    if (unavailableToastTimer !== null) window.clearTimeout(unavailableToastTimer)
})
</script>

<template>
    <fieldset
        :class="
            embedded
                ? 'min-w-0 border-0 bg-transparent p-0'
                : 'rounded-2xl border border-brand/30 bg-brand/5 p-3'
        "
        data-testid="analysis-content-kind-selector"
    >
        <legend class="text-xs font-semibold text-ink">
            {{ t('workspace.contentKind.label') }}
        </legend>
        <div class="mt-2 grid grid-cols-2 gap-2" role="radiogroup">
            <button
                v-for="kind in kinds"
                :key="kind"
                class="min-h-10 rounded-xl border px-2 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
                :class="[
                    modelValue === kind
                        ? 'border-brand bg-brand/10 text-brand'
                        : 'border-line bg-surface text-muted hover:border-brand/50 hover:text-ink',
                    kind === 'video' && !videoEnabled ? 'cursor-not-allowed opacity-50' : '',
                ]"
                type="button"
                role="radio"
                :aria-checked="modelValue === kind"
                :aria-disabled="disabled || (kind === 'video' && !videoEnabled)"
                :disabled="disabled"
                @click="selectContentKind(kind)"
            >
                {{ t(`workspace.contentKind.${kind}`) }}
            </button>
        </div>

        <ToastMessage
            :visible="unavailableToastVisible"
            :message="
                videoUnavailableMessage || t('workspace.contentKind.videoUnavailable')
            "
        />
    </fieldset>
</template>
