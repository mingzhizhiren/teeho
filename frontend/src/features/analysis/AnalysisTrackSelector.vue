<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/icons/AppIcon.vue'
import ToastMessage from '@/components/ToastMessage.vue'
import { analysisUiConstraints } from './analysis.constants'
import type { AnalysisTrackDefinition } from './analysis.contract'
import { filterAnalysisTracks } from './analysis.track-selection'

const props = withDefaults(
    defineProps<{
        tracks: readonly AnalysisTrackDefinition[]
        modelValue: string | null
        customTrackName: string | null
        locked: boolean
        disabled?: boolean
        embedded?: boolean
    }>(),
    { disabled: false, embedded: false },
)
const emit = defineEmits<{
    'update:modelValue': [trackId: string | null]
    'update:customTrackName': [name: string | null]
}>()
const { t } = useI18n()
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const query = ref('')
const isOpen = ref(false)
const lockedToastVisible = ref(false)
const opensUpward = ref(false)
const listboxMaximumHeightPx = 240
const listboxGapPx = 8
const viewportEdgeMarginPx = 12
const listboxMaxHeightPx = ref(listboxMaximumHeightPx)
const listboxId = `analysis-track-listbox-${useId()}`
let lockedToastTimer: number | null = null
const filteredTracks = computed(() =>
    filterAnalysisTracks(props.tracks, query.value, (track) => t(track.labelKey)),
)
const selectedTrack = computed(() => props.tracks.find((track) => track.id === props.modelValue))
const currentLabel = computed(() =>
    selectedTrack.value ? t(selectedTrack.value.labelKey) : t('workspace.trackSelector.choose'),
)

function optionElements(): HTMLButtonElement[] {
    return Array.from(root.value?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])
}

function updateListboxPlacement() {
    const bounds = trigger.value?.getBoundingClientRect()
    if (!bounds) return
    const spaceBelow = Math.max(
        0,
        window.innerHeight - bounds.bottom - listboxGapPx - viewportEdgeMarginPx,
    )
    const spaceAbove = Math.max(0, bounds.top - listboxGapPx - viewportEdgeMarginPx)
    opensUpward.value = spaceBelow < listboxMaximumHeightPx && spaceAbove > spaceBelow
    const availableSpace = opensUpward.value ? spaceAbove : spaceBelow
    listboxMaxHeightPx.value = Math.min(listboxMaximumHeightPx, availableSpace)
}

async function openAndFocus(position: 'first' | 'last' | 'selected' = 'selected') {
    if (props.locked) {
        showLockedToast()
        return
    }
    if (props.disabled) return
    isOpen.value = true
    await nextTick()
    updateListboxPlacement()
    const options = optionElements()
    if (position === 'first') {
        options[0]?.focus()
        return
    }
    if (position === 'last') {
        options[options.length - 1]?.focus()
        return
    }
    const selectedOption = options.find(
        (option) => option.dataset.trackId === (props.modelValue ?? ''),
    )
    const optionToFocus = selectedOption ?? options[0]
    optionToFocus?.focus()
}

function closeAndRestoreFocus() {
    isOpen.value = false
    void nextTick(() => trigger.value?.focus())
}

function toggle() {
    if (props.locked) {
        showLockedToast()
        return
    }
    if (props.disabled) return
    isOpen.value = !isOpen.value
    if (isOpen.value) void nextTick(updateListboxPlacement)
}

function showLockedToast() {
    lockedToastVisible.value = true
    if (lockedToastTimer !== null) {
        window.clearTimeout(lockedToastTimer)
    }
    lockedToastTimer = window.setTimeout(() => {
        lockedToastVisible.value = false
        lockedToastTimer = null
    }, analysisUiConstraints.actionToastDurationMs)
}

function selectTrack(trackId: string | null) {
    emit('update:modelValue', trackId)
    if (!props.tracks.find((track) => track.id === trackId)?.custom) {
        emit('update:customTrackName', null)
    }
    closeAndRestoreFocus()
}

function updateCustomTrackName(event: Event) {
    const value = (event.target as HTMLInputElement).value.trim()
    emit('update:customTrackName', value || null)
}

function handleTriggerKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
        event.preventDefault()
        void openAndFocus('first')
    } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        void openAndFocus('last')
    } else if (event.key === 'Escape' && isOpen.value) {
        event.preventDefault()
        closeAndRestoreFocus()
    }
}

function handleOptionKeydown(event: KeyboardEvent, index: number) {
    const options = optionElements()
    const lastIndex = options.length - 1
    let nextIndex: number | null = null
    if (event.key === 'ArrowDown') nextIndex = index === lastIndex ? 0 : index + 1
    else if (event.key === 'ArrowUp') nextIndex = index === 0 ? lastIndex : index - 1
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = lastIndex
    else if (event.key === 'Escape') {
        event.preventDefault()
        closeAndRestoreFocus()
        return
    } else if (event.key === 'Tab') {
        event.preventDefault()
        if (event.shiftKey) {
            closeAndRestoreFocus()
        } else {
            searchInput.value?.focus()
        }
        return
    }
    if (nextIndex === null) return
    event.preventDefault()
    options[nextIndex]?.focus()
}

function handleSearchKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
        event.preventDefault()
        closeAndRestoreFocus()
        return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const options = optionElements()
        const option = event.key === 'ArrowDown' ? options[0] : options[options.length - 1]
        option?.focus()
        return
    }
    if (event.key === 'Tab') isOpen.value = false
}

function handleDocumentPointerDown(event: PointerEvent) {
    if (event.target instanceof Node && !root.value?.contains(event.target)) {
        isOpen.value = false
    }
}

function handleWindowResize() {
    if (isOpen.value) updateListboxPlacement()
}

watch(
    () => [props.locked, props.disabled] as const,
    ([locked, disabled]) => {
        if (locked || disabled) isOpen.value = false
    },
)

onMounted(() => {
    document.addEventListener('pointerdown', handleDocumentPointerDown)
    window.addEventListener('resize', handleWindowResize)
})
onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', handleDocumentPointerDown)
    window.removeEventListener('resize', handleWindowResize)
    if (lockedToastTimer !== null) {
        window.clearTimeout(lockedToastTimer)
    }
})
</script>

<template>
    <fieldset
        ref="root"
        class="relative"
        :class="
            embedded
                ? 'min-w-0 border-0 bg-transparent p-0'
                : 'rounded-2xl border border-brand/30 bg-brand/5 p-3'
        "
        data-testid="analysis-track-selector"
    >
        <legend class="text-xs font-semibold text-ink">
            {{ t('workspace.trackSelector.label') }}
        </legend>
        <div class="relative mt-2 min-w-0">
            <button
                id="analysis-track-select"
                ref="trigger"
                class="flex min-h-10 w-full items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-left text-xs font-medium text-ink shadow-sm outline-none transition hover:border-brand/40 hover:bg-surface-muted focus-visible:border-brand focus-visible:ring-4 focus-visible:ring-brand/10 disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
                role="combobox"
                aria-haspopup="listbox"
                :aria-label="t('workspace.trackSelector.selectLabel')"
                :aria-expanded="isOpen"
                :aria-controls="listboxId"
                :data-selected-track-id="modelValue ?? ''"
                :class="locked ? 'cursor-not-allowed opacity-60' : ''"
                :disabled="disabled"
                :aria-disabled="locked || disabled"
                @click="toggle"
                @keydown="handleTriggerKeydown"
            >
                <span class="min-w-0 truncate">{{ currentLabel }}</span>
                <AppIcon
                    class="shrink-0 text-muted transition-transform duration-200"
                    :class="isOpen ? 'rotate-180' : ''"
                    name="chevron-down"
                    size="sm"
                />
            </button>

            <Transition
                enter-active-class="transition duration-150 ease-out"
                enter-from-class="-translate-y-1 opacity-0"
                enter-to-class="translate-y-0 opacity-100"
                leave-active-class="transition duration-100 ease-in"
                leave-from-class="translate-y-0 opacity-100"
                leave-to-class="-translate-y-1 opacity-0"
            >
                <div
                    v-if="isOpen"
                    class="absolute left-0 z-[90] flex w-full min-w-48 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-xl"
                    :class="opensUpward ? 'bottom-full mb-2' : 'top-full mt-2'"
                    :style="{ maxHeight: `${listboxMaxHeightPx}px` }"
                    data-testid="analysis-track-menu"
                >
                    <div
                        :id="listboxId"
                        class="track-listbox min-h-0 flex-1 overflow-y-auto p-1"
                        role="listbox"
                        :aria-label="t('workspace.trackSelector.selectLabel')"
                    >
                        <button
                            class="flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                            :class="
                                modelValue === null
                                    ? 'bg-brand/10 text-brand'
                                    : 'text-ink hover:bg-surface-muted'
                            "
                            type="button"
                            role="option"
                            tabindex="-1"
                            data-track-id=""
                            :aria-selected="modelValue === null"
                            @click="selectTrack(null)"
                            @keydown="handleOptionKeydown($event, 0)"
                        >
                            <AppIcon
                                class="shrink-0"
                                :class="modelValue === null ? 'opacity-100' : 'opacity-0'"
                                name="check"
                                size="sm"
                            />
                            <span>{{ t('workspace.trackSelector.choose') }}</span>
                        </button>

                        <button
                            v-for="(track, index) in filteredTracks"
                            :key="track.code"
                            class="flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                            :class="
                                track.id === modelValue
                                    ? 'bg-brand/10 text-brand'
                                    : 'text-ink hover:bg-surface-muted'
                            "
                            type="button"
                            role="option"
                            tabindex="-1"
                            :data-track-id="track.id"
                            :aria-selected="track.id === modelValue"
                            @click="selectTrack(track.id)"
                            @keydown="handleOptionKeydown($event, index + 1)"
                        >
                            <AppIcon
                                class="shrink-0"
                                :class="track.id === modelValue ? 'opacity-100' : 'opacity-0'"
                                name="check"
                                size="sm"
                            />
                            <span>{{ t(track.labelKey) }}</span>
                        </button>
                    </div>

                    <div
                        class="flex shrink-0 items-center gap-2 border-t border-line bg-surface px-2.5 py-1.5"
                        data-testid="analysis-track-search-footer"
                    >
                        <AppIcon class="shrink-0 text-muted" name="search" size="sm" />
                        <input
                            id="analysis-track-search"
                            ref="searchInput"
                            v-model="query"
                            type="search"
                            class="min-h-8 min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-muted/70"
                            :aria-label="t('workspace.trackSelector.searchPlaceholder')"
                            :placeholder="t('workspace.trackSelector.searchPlaceholder')"
                            @keydown="handleSearchKeydown"
                        />
                    </div>
                </div>
            </Transition>
        </div>

        <label
            v-if="selectedTrack?.custom"
            class="mt-2 block text-[11px] font-semibold text-ink"
            for="analysis-custom-track-name"
        >
            {{ t('workspace.trackSelector.customLabel') }}
        </label>
        <input
            v-if="selectedTrack?.custom"
            id="analysis-custom-track-name"
            :value="customTrackName ?? ''"
            class="mt-1.5 w-full rounded-xl border border-line bg-surface px-3 py-2 text-xs text-ink outline-none transition placeholder:text-muted/70 focus:border-brand focus:ring-2 focus:ring-brand/15 disabled:cursor-not-allowed disabled:opacity-60"
            :placeholder="t('workspace.trackSelector.customPlaceholder')"
            :maxlength="100"
            :disabled="locked || disabled"
            @input="updateCustomTrackName"
        />
    </fieldset>
    <ToastMessage :visible="lockedToastVisible" :message="t('workspace.trackSelector.locked')" />
</template>

<style scoped>
.track-listbox {
    scrollbar-color: rgb(var(--color-border)) transparent;
    scrollbar-width: thin;
}

.track-listbox::-webkit-scrollbar {
    width: 0.5rem;
}

.track-listbox::-webkit-scrollbar-thumb {
    border: 0.125rem solid transparent;
    border-radius: 9999px;
    background: rgb(var(--color-border));
    background-clip: padding-box;
}
</style>
