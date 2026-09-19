<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from '@/components/icons/AppIcon.vue'

const props = withDefaults(
    defineProps<{
        open: boolean
        title: string
        description: string
        notice?: string
        confirmLabel: string
        cancelLabel: string
        tone?: 'default' | 'danger'
        busy?: boolean
    }>(),
    {
        tone: 'default',
        busy: false,
        notice: undefined,
    },
)

const emit = defineEmits<{
    confirm: []
    cancel: []
    'update:open': [open: boolean]
}>()

const dialog = ref<HTMLElement | null>(null)
const cancelButton = ref<HTMLButtonElement | null>(null)
const randomIdentifierRadix = 36
const randomIdentifierPrefixLength = 2
/** 生成确认弹窗元素使用的随机标识 */
const randomIdentifier = () =>
    Math.random().toString(randomIdentifierRadix).slice(randomIdentifierPrefixLength)
const titleId = `confirm-dialog-title-${randomIdentifier()}`
const descriptionId = `confirm-dialog-description-${randomIdentifier()}`
const noticeId = `confirm-dialog-notice-${randomIdentifier()}`
const iconClass = computed(() =>
    props.tone === 'danger'
        ? 'bg-red-50 text-red-600 dark:bg-red-400/10 dark:text-red-300'
        : 'bg-brand/10 text-brand',
)
const confirmButtonClass = computed(() =>
    props.tone === 'danger'
        ? 'bg-red-600 text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600'
        : 'bg-brand text-on-brand hover:bg-brand-hover',
)

let previouslyFocused: HTMLElement | null = null
let previousBodyOverflow = ''
let bodyScrollLocked = false

/** 取消当前确认操作并关闭弹窗 */
function cancel() {
    if (props.busy) {
        return
    }
    emit('update:open', false)
    emit('cancel')
}

/** 处理弹窗键盘关闭操作 */
function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
        event.preventDefault()
        cancel()
        return
    }
    if (event.key !== 'Tab' || !dialog.value) {
        return
    }

    const focusableElements = Array.from(
        dialog.value.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
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

/** 恢复弹窗打开前的页面滚动和焦点状态 */
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
        cancelButton.value?.focus()
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
                class="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm"
                role="presentation"
                @click.self="cancel"
            >
                <section
                    ref="dialog"
                    class="w-full max-w-md rounded-3xl border border-line bg-surface p-6 shadow-2xl sm:p-7"
                    role="dialog"
                    aria-modal="true"
                    :aria-labelledby="titleId"
                    :aria-describedby="notice ? `${descriptionId} ${noticeId}` : descriptionId"
                    data-testid="confirm-dialog"
                    @keydown="handleKeydown"
                >
                    <div
                        class="flex h-12 w-12 items-center justify-center rounded-2xl"
                        :class="iconClass"
                        aria-hidden="true"
                    >
                        <AppIcon name="warning" size="lg" />
                    </div>

                    <h2 :id="titleId" class="mt-5 text-xl font-semibold tracking-tight text-ink">
                        {{ title }}
                    </h2>
                    <p :id="descriptionId" class="mt-3 text-sm leading-6 text-muted">
                        {{ description }}
                    </p>
                    <p
                        v-if="notice"
                        :id="noticeId"
                        class="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100"
                    >
                        {{ notice }}
                    </p>

                    <div class="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                        <button
                            ref="cancelButton"
                            class="rounded-xl border border-line bg-surface px-5 py-3 text-sm font-semibold text-ink transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
                            type="button"
                            :disabled="busy"
                            @click="cancel"
                        >
                            {{ cancelLabel }}
                        </button>
                        <button
                            class="rounded-xl px-5 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
                            :class="confirmButtonClass"
                            type="button"
                            :disabled="busy"
                            @click="$emit('confirm')"
                        >
                            {{ confirmLabel }}
                        </button>
                    </div>
                </section>
            </div>
        </Transition>
    </Teleport>
</template>
