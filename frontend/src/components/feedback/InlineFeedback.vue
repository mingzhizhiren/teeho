<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import AppIcon from '@/components/icons/AppIcon.vue'
import type { AppIconName } from '@/components/icons/appIcon'
import type { FeedbackAction, FeedbackDismissPolicy, UiFeedback } from './feedback'
import {
    DEFAULT_INTERACTION_FEEDBACK_MINIMUM_VISIBLE_MS,
    interactionFeedbackCoordinatorKey,
    type InteractionFeedbackRegistration,
} from './interactionFeedback'

const props = withDefaults(
    defineProps<{
        feedback: UiFeedback
        elementId?: string
        compact?: boolean
        dismissPolicy?: FeedbackDismissPolicy
        minimumVisibleMs?: number
    }>(),
    {
        elementId: undefined,
        compact: false,
        dismissPolicy: 'persistent',
        minimumVisibleMs: DEFAULT_INTERACTION_FEEDBACK_MINIMUM_VISIBLE_MS,
    },
)

const emit = defineEmits<{
    action: [action: FeedbackAction]
    dismiss: []
}>()
const feedbackElement = ref<HTMLElement | null>(null)
const coordinator = inject(interactionFeedbackCoordinatorKey, null)
let registration: InteractionFeedbackRegistration | null = null
let visibilityObserver: IntersectionObserver | null = null

const toneClass = computed(() => {
    switch (props.feedback.tone) {
        case 'error':
            return 'border-red-200 bg-red-50 text-red-700 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-200'
        case 'success':
            return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200'
        case 'warning':
            return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100'
        case 'info':
            return 'border-brand/25 bg-brand/10 text-brand'
    }
    return 'border-brand/25 bg-brand/10 text-brand'
})

const role = computed(() => {
    if (props.feedback.announce === 'assertive') return 'alert'
    if (props.feedback.announce === 'polite') return 'status'
    return undefined
})
const feedbackIcon = computed<AppIconName>(() => {
    if (props.feedback.tone === 'success') return 'check'
    if (props.feedback.tone === 'info') return 'info'
    return 'warning'
})

function teardownInteractionDismissal() {
    visibilityObserver?.disconnect()
    visibilityObserver = null
    registration?.unregister()
    registration = null
}

function isElementInViewport(element: HTMLElement) {
    const rect = element.getBoundingClientRect()
    return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth
    )
}

function setupInteractionDismissal() {
    teardownInteractionDismissal()
    const element = feedbackElement.value
    if (props.dismissPolicy !== 'after-interaction' || !coordinator || !element) return

    registration = coordinator.register({
        minimumVisibleMs: props.minimumVisibleMs,
        containsTarget: (target) => target instanceof Node && element.contains(target),
        onDismiss: () => emit('dismiss'),
    })
    registration.setVisible(isElementInViewport(element))
    if (typeof IntersectionObserver === 'undefined') {
        return
    }

    visibilityObserver = new IntersectionObserver(([entry]) => {
        if (!entry?.isIntersecting) return
        registration?.setVisible(true)
    })
    visibilityObserver.observe(element)
}

onMounted(setupInteractionDismissal)
watch(
    [() => props.dismissPolicy, () => props.minimumVisibleMs, () => props.feedback.key],
    setupInteractionDismissal,
)
onBeforeUnmount(teardownInteractionDismissal)
</script>

<template>
    <div
        :id="elementId"
        ref="feedbackElement"
        class="flex items-start gap-3 rounded-xl border leading-6"
        :class="[toneClass, compact ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm']"
        :role="role"
        :aria-live="feedback.announce"
        :data-feedback-key="feedback.key"
    >
        <AppIcon class="mt-0.5 shrink-0" :name="feedbackIcon" size="sm" />

        <p class="min-w-0 flex-1">{{ feedback.message }}</p>

        <button
            v-if="feedback.action"
            class="shrink-0 rounded-lg px-2 py-1 font-semibold underline-offset-4 transition hover:bg-current/5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
            type="button"
            @click="emit('action', feedback.action)"
        >
            {{ feedback.action.label }}
        </button>
    </div>
</template>
