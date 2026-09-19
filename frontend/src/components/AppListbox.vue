<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'

import AppIcon from '@/components/icons/AppIcon.vue'

export interface AppListboxOption {
    readonly value: string
    readonly label: string
}

const props = withDefaults(
    defineProps<{
        modelValue: string
        options: readonly AppListboxOption[]
        label: string
        placeholder: string
        inputId?: string
        disabled?: boolean
    }>(),
    {
        inputId: undefined,
        disabled: false,
    },
)
const emit = defineEmits<{
    'update:modelValue': [value: string]
}>()

const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const isOpen = ref(false)
const opensUpward = ref(false)
const listboxMaximumHeightPx = 288
const listboxGapPx = 8
const viewportEdgeMarginPx = 12
const listboxMaxHeightPx = ref(listboxMaximumHeightPx)
const listboxId = `app-listbox-${useId()}`
const currentLabel = computed(
    () =>
        props.options.find((option) => option.value === props.modelValue)?.label ??
        props.placeholder,
)

function optionElements(): HTMLButtonElement[] {
    return Array.from(
        root.value?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    )
}

function updateListboxPlacement() {
    const bounds = trigger.value?.getBoundingClientRect()
    if (!bounds) return
    const spaceBelow = Math.max(
        0,
        window.innerHeight - bounds.bottom - listboxGapPx - viewportEdgeMarginPx,
    )
    const spaceAbove = Math.max(0, bounds.top - listboxGapPx - viewportEdgeMarginPx)
    opensUpward.value =
        spaceBelow < listboxMaximumHeightPx && spaceAbove > spaceBelow
    const availableSpace = opensUpward.value ? spaceAbove : spaceBelow
    listboxMaxHeightPx.value = Math.min(listboxMaximumHeightPx, availableSpace)
}

async function openAndFocus(position: 'first' | 'last' | 'selected' = 'selected') {
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
        (option) => option.dataset.optionValue === props.modelValue,
    )
    const optionToFocus = selectedOption ?? options[0]
    optionToFocus?.focus()
}

function closeAndRestoreFocus() {
    isOpen.value = false
    void nextTick(() => trigger.value?.focus())
}

function toggle() {
    if (props.disabled) return
    isOpen.value = !isOpen.value
    if (isOpen.value) void nextTick(updateListboxPlacement)
}

function selectOption(value: string) {
    emit('update:modelValue', value)
    closeAndRestoreFocus()
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
        isOpen.value = false
        return
    }
    if (nextIndex === null) return
    event.preventDefault()
    options[nextIndex]?.focus()
}

function handleDocumentPointerDown(event: PointerEvent) {
    if (event.target instanceof Node && !root.value?.contains(event.target)) {
        isOpen.value = false
    }
}

function handleViewportChange() {
    if (isOpen.value) updateListboxPlacement()
}

watch(
    () => props.disabled,
    (disabled) => {
        if (disabled) isOpen.value = false
    },
)

onMounted(() => {
    document.addEventListener('pointerdown', handleDocumentPointerDown)
    document.addEventListener('scroll', handleViewportChange, true)
    window.addEventListener('resize', handleViewportChange)
})
onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', handleDocumentPointerDown)
    document.removeEventListener('scroll', handleViewportChange, true)
    window.removeEventListener('resize', handleViewportChange)
})
</script>

<template>
    <div ref="root" class="relative min-w-0">
        <button
            :id="inputId"
            ref="trigger"
            class="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-3 text-left text-sm shadow-sm outline-none transition hover:border-brand/40 hover:bg-surface-muted focus-visible:border-brand focus-visible:ring-4 focus-visible:ring-brand/10 disabled:cursor-not-allowed disabled:opacity-60"
            :class="modelValue ? 'font-medium text-ink' : 'text-muted'"
            type="button"
            role="combobox"
            aria-haspopup="listbox"
            :aria-label="label"
            :aria-expanded="isOpen"
            :aria-controls="listboxId"
            :disabled="disabled"
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
                :id="listboxId"
                class="app-listbox absolute left-0 z-[90] w-full min-w-52 overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-xl"
                :class="opensUpward ? 'bottom-full mb-2' : 'top-full mt-2'"
                :style="{ maxHeight: `${listboxMaxHeightPx}px` }"
                role="listbox"
                :aria-label="label"
            >
                <button
                    class="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    :class="
                        modelValue === ''
                            ? 'bg-brand/10 text-brand'
                            : 'text-ink hover:bg-surface-muted'
                    "
                    type="button"
                    role="option"
                    data-option-value=""
                    :aria-selected="modelValue === ''"
                    @click="selectOption('')"
                    @keydown="handleOptionKeydown($event, 0)"
                >
                    <AppIcon
                        class="shrink-0"
                        :class="modelValue === '' ? 'opacity-100' : 'opacity-0'"
                        name="check"
                        size="sm"
                    />
                    <span>{{ placeholder }}</span>
                </button>

                <button
                    v-for="(option, index) in options"
                    :key="option.value"
                    class="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    :class="
                        option.value === modelValue
                            ? 'bg-brand/10 text-brand'
                            : 'text-ink hover:bg-surface-muted'
                    "
                    type="button"
                    role="option"
                    :data-option-value="option.value"
                    :aria-selected="option.value === modelValue"
                    @click="selectOption(option.value)"
                    @keydown="handleOptionKeydown($event, index + 1)"
                >
                    <AppIcon
                        class="shrink-0"
                        :class="option.value === modelValue ? 'opacity-100' : 'opacity-0'"
                        name="check"
                        size="sm"
                    />
                    <span>{{ option.label }}</span>
                </button>
            </div>
        </Transition>
    </div>
</template>

<style scoped>
.app-listbox {
    scrollbar-color: rgb(var(--color-border)) transparent;
    scrollbar-width: thin;
}

.app-listbox::-webkit-scrollbar {
    width: 0.5rem;
}

.app-listbox::-webkit-scrollbar-thumb {
    border: 0.125rem solid transparent;
    border-radius: 9999px;
    background: rgb(var(--color-border));
    background-clip: padding-box;
}
</style>
