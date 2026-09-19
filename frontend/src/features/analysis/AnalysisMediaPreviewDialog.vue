<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

import AppIcon from '@/components/icons/AppIcon.vue'

const props = defineProps<{
    open: boolean
    kind: 'image' | 'video'
    source: string
    title: string
    closeLabel: string
}>()
const emit = defineEmits<{
    'update:open': [open: boolean]
}>()

const dialog = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
let previouslyFocused: HTMLElement | null = null
let previousBodyOverflow = ''
let bodyScrollLocked = false
const titleId = `media-preview-title-${crypto.randomUUID()}`

function close() {
    emit('update:open', false)
}

function restorePage() {
    if (bodyScrollLocked) {
        document.body.style.overflow = previousBodyOverflow
        bodyScrollLocked = false
    }
    if (previouslyFocused?.isConnected) {
        previouslyFocused.focus()
    }
    previouslyFocused = null
}

function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
    }
    if (event.key !== 'Tab' || !dialog.value) {
        return
    }
    const focusableElements = Array.from(
        dialog.value.querySelectorAll<HTMLElement>(
            'button:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])',
        ),
    )
    const firstElement = focusableElements[0]
    const lastElement = focusableElements[focusableElements.length - 1]
    if (!firstElement || !lastElement) {
        event.preventDefault()
        return
    }
    if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault()
        lastElement.focus()
    } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault()
        firstElement.focus()
    }
}

watch(
    () => props.open,
    async (open) => {
        if (!open) {
            restorePage()
            return
        }
        previouslyFocused =
            document.activeElement instanceof HTMLElement ? document.activeElement : null
        previousBodyOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        bodyScrollLocked = true
        await nextTick()
        closeButton.value?.focus()
    },
    { flush: 'post' },
)

onBeforeUnmount(restorePage)
</script>

<template>
    <Teleport to="body">
        <Transition
            enter-active-class="transition duration-200 ease-out"
            enter-from-class="opacity-0"
            enter-to-class="opacity-100"
            leave-active-class="transition duration-150 ease-in"
            leave-from-class="opacity-100"
            leave-to-class="pointer-events-none opacity-0"
        >
            <div
                v-if="open"
                class="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/85 p-3 backdrop-blur-sm sm:p-6"
                role="presentation"
                @click.self="close"
                @keydown="handleKeydown"
            >
                <section
                    ref="dialog"
                    class="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-950 shadow-2xl sm:max-h-[calc(100dvh-3rem)]"
                    role="dialog"
                    aria-modal="true"
                    :aria-labelledby="titleId"
                    data-testid="media-preview-dialog"
                >
                    <header
                        class="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 px-4 py-3"
                    >
                        <h2 :id="titleId" class="truncate text-sm font-semibold text-white">
                            {{ title }}
                        </h2>
                        <button
                            ref="closeButton"
                            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/15 text-white transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                            type="button"
                            :aria-label="closeLabel"
                            @click="close"
                        >
                            <AppIcon name="close" size="md" />
                        </button>
                    </header>

                    <div
                        class="flex min-h-0 flex-1 items-center justify-center overflow-auto p-2 sm:p-4"
                    >
                        <img
                            v-if="kind === 'image'"
                            class="max-h-[calc(100dvh-7rem)] max-w-full object-contain"
                            :src="source"
                            :alt="title"
                            data-testid="media-preview-image"
                        />
                        <video
                            v-else
                            class="max-h-[calc(100dvh-7rem)] max-w-full bg-black"
                            :src="source"
                            controls
                            playsinline
                            preload="metadata"
                            data-testid="media-preview-video"
                        ></video>
                    </div>
                </section>
            </div>
        </Transition>
    </Teleport>
</template>
