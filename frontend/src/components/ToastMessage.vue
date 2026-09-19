<script setup lang="ts">
defineProps<{
    visible: boolean
    message: string
}>()
</script>

<template>
    <Teleport to="body">
        <Transition
            enter-active-class="transition duration-200 ease-out"
            enter-from-class="translate-y-2 opacity-0"
            enter-to-class="translate-y-0 opacity-100"
            leave-active-class="transition duration-150 ease-in"
            leave-from-class="translate-y-0 opacity-100"
            leave-to-class="translate-y-2 opacity-0"
        >
            <div
                v-if="visible"
                class="pointer-events-none fixed bottom-6 left-1/2 z-[100] flex min-h-14 w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-2xl border border-line bg-surface/95 px-4 py-3 text-sm font-medium text-ink shadow-[0_12px_36px_-14px_rgba(15,23,42,0.45)] backdrop-blur-xl sm:w-auto sm:rounded-full sm:px-5"
                role="status"
                aria-live="polite"
                aria-atomic="true"
                data-testid="toast-message"
            >
                <span
                    class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand/10 p-1"
                    aria-hidden="true"
                >
                    <img
                        class="h-full w-full object-contain"
                        src="/images/main/small_LOGO.png"
                        alt=""
                    />
                </span>
                <span
                    class="min-w-0 flex-1 whitespace-normal break-words leading-5"
                    data-testid="toast-message-text"
                >
                    {{ message }}
                </span>
            </div>
        </Transition>
    </Teleport>
</template>
