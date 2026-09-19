<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/icons/AppIcon.vue'
import { setLocale } from '@/locales'
import { appLocaleSchema, type AppLocale } from '@/utils/appConfig'

interface LanguageOption {
    readonly value: AppLocale
    readonly label: string
}

const { locale, t } = useI18n()
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const isOpen = ref(false)
const listboxId = `language-listbox-${useId()}`
const languageOptions = computed<readonly LanguageOption[]>(() => [
    { value: 'zh-CN', label: t('common.languages.chinese') },
    { value: 'en-US', label: t('common.languages.english') },
])
const currentLabel = computed(
    () =>
        languageOptions.value.find((option) => option.value === locale.value)?.label ??
        languageOptions.value[0].label,
)

function optionElements() {
    return Array.from(
        root.value?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    )
}

async function openAndFocus(index: number) {
    isOpen.value = true
    await nextTick()
    optionElements()[index]?.focus()
}

function closeAndRestoreFocus() {
    isOpen.value = false
    void nextTick(() => trigger.value?.focus())
}

function toggle() {
    isOpen.value = !isOpen.value
}

function selectLanguage(value: unknown) {
    const result = appLocaleSchema.safeParse(value)
    if (!result.success) return
    setLocale(result.data)
    closeAndRestoreFocus()
}

function handleTriggerKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
        event.preventDefault()
        void openAndFocus(0)
    } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        void openAndFocus(languageOptions.value.length - 1)
    } else if (event.key === 'Escape' && isOpen.value) {
        event.preventDefault()
        closeAndRestoreFocus()
    }
}

function handleOptionKeydown(event: KeyboardEvent, index: number) {
    const lastIndex = languageOptions.value.length - 1
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
    optionElements()[nextIndex]?.focus()
}

function handleDocumentPointerDown(event: PointerEvent) {
    if (event.target instanceof Node && !root.value?.contains(event.target)) {
        isOpen.value = false
    }
}

onMounted(() => document.addEventListener('pointerdown', handleDocumentPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', handleDocumentPointerDown))
</script>

<template>
    <div ref="root" class="relative inline-flex text-sm">
        <button
            ref="trigger"
            class="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-ink shadow-sm transition hover:border-brand/40 hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/10"
            type="button"
            role="combobox"
            :aria-label="t('common.language')"
            :title="`${t('common.language')}：${currentLabel}`"
            aria-haspopup="listbox"
            :aria-expanded="isOpen"
            :aria-controls="listboxId"
            @click="toggle"
            @keydown="handleTriggerKeydown"
        >
            <AppIcon class="text-muted" name="globe" />
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
                class="absolute right-0 top-full z-[80] mt-2 min-w-36 overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-xl"
                role="listbox"
                :aria-label="t('common.language')"
            >
                <button
                    v-for="(option, index) in languageOptions"
                    :key="option.value"
                    class="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    :class="
                        option.value === locale
                            ? 'bg-brand/10 text-brand'
                            : 'text-ink hover:bg-surface-muted'
                    "
                    type="button"
                    role="option"
                    :aria-selected="option.value === locale"
                    @click="selectLanguage(option.value)"
                    @keydown="handleOptionKeydown($event, index)"
                >
                    <AppIcon
                        class="shrink-0"
                        :class="option.value === locale ? 'opacity-100' : 'opacity-0'"
                        name="check"
                        size="sm"
                    />
                    <span>{{ option.label }}</span>
                </button>
            </div>
        </Transition>
    </div>
</template>
