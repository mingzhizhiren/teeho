<script setup lang="ts">
import { nextTick, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/icons/AppIcon.vue'
import type { TaskFieldName } from './analysis.contract'
import { useAnalysisComposerContext } from './analysisComposer.context'

const { t } = useI18n()
const conversationLog = ref<HTMLElement | null>(null)
const taskDetailsExpanded = ref(false)
const taskDetailsId = `agent-task-details-${useId()}`
const {
    draftPreview,
    submitting,
    checkingStorage,
    agentMessages,
    agentTyping,
    hasAgentReplyContext,
    agentConfirmationCurrent,
    submissionActionLabel,
    coreConfiguredFields,
    resolvedField,
    formatFieldValue,
    submitDraft,
} = useAnalysisComposerContext()
const conversationMessages = agentMessages

function toggleTaskDetails() {
    taskDetailsExpanded.value = !taskDetailsExpanded.value
}

function fieldValueClass(fieldName: TaskFieldName): string {
    return resolvedField(fieldName) ? 'font-semibold text-ink' : 'font-medium text-muted'
}

watch([() => agentConfirmationCurrent.value, () => draftPreview.value], () => {
    taskDetailsExpanded.value = false
})

watch(
    [
        () => agentMessages.value.length,
        () => agentTyping.value,
        () => agentConfirmationCurrent.value,
        () => taskDetailsExpanded.value,
    ],
    async () => {
        await nextTick()
        conversationLog.value?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    },
)
</script>

<template>
    <div
        ref="conversationLog"
        v-guide-anchor="hasAgentReplyContext ? 'onboarding.agent-reply.region' : null"
        class="min-h-72 space-y-5"
        role="log"
        data-testid="analysis-conversation-log"
        :aria-label="t('workspace.agentChat.logLabel')"
    >
        <div
            v-for="message in conversationMessages"
            :key="message.id"
            class="flex items-end gap-3"
            :class="message.role === 'user' ? 'justify-end' : 'justify-start'"
        >
            <span
                v-if="message.role === 'agent'"
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 p-1"
                data-testid="agent-avatar"
                aria-hidden="true"
            >
                <img
                    class="h-full w-full object-contain"
                    src="/images/main/small_LOGO.png"
                    alt=""
                />
            </span>
            <div
                class="max-w-[min(42rem,85%)]"
                :class="message.kind === 'greeting' ? 'flex flex-nowrap items-center gap-2' : ''"
            >
                <div
                    class="min-w-0 whitespace-pre-wrap text-sm leading-6"
                    :data-testid="message.role === 'agent' ? 'agent-message' : 'user-message'"
                    :data-typing="message.typing"
                    :data-thinking="Boolean(message.thinking)"
                    :data-message-kind="message.kind"
                    :class="
                        message.role === 'user'
                            ? 'rounded-2xl rounded-br-md bg-brand px-4 py-3 text-on-brand shadow-sm'
                            : 'rounded-2xl rounded-bl-md border border-line bg-surface-muted px-4 py-3 text-ink shadow-sm'
                    "
                >
                    <span
                        v-if="message.thinking"
                        class="inline-block animate-pulse font-semibold tracking-[0.2em]"
                        :aria-label="t('workspace.agentChat.thinking')"
                    >...</span
                    >
                    <template v-else>{{ message.text }}</template
                    ><span
                        v-if="message.typing"
                        class="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-current align-middle"
                        aria-hidden="true"
                    ></span>
                </div>
            </div>
        </div>
        <div v-if="agentConfirmationCurrent" class="ml-0 sm:ml-12" data-testid="agent-confirmation">
            <button
                v-guide-anchor="'onboarding.task-confirmation.card'"
                class="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold shadow-sm transition hover:border-brand/40 hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/10"
                type="button"
                data-testid="agent-confirmation-toggle"
                :aria-label="t('workspace.agentChat.taskSummaryButtonLabel')"
                :aria-expanded="taskDetailsExpanded"
                :aria-controls="taskDetailsId"
                @click="toggleTaskDetails"
            >
                <span class="text-ink">{{ t('workspace.agentChat.taskSummary') }}</span>
                <span class="text-muted" aria-hidden="true">|</span>
                <span class="text-brand">{{ t('workspace.agentChat.analysisReady') }}</span>
                <AppIcon
                    class="ml-1 text-muted transition-transform duration-200"
                    :class="taskDetailsExpanded ? 'rotate-180' : ''"
                    name="chevron-down"
                    size="sm"
                />
            </button>

            <Transition
                enter-active-class="transition duration-200 ease-out"
                enter-from-class="-translate-y-1 opacity-0"
                enter-to-class="translate-y-0 opacity-100"
                leave-active-class="transition duration-150 ease-in"
                leave-from-class="translate-y-0 opacity-100"
                leave-to-class="-translate-y-1 opacity-0"
            >
                <div
                    v-if="taskDetailsExpanded"
                    :id="taskDetailsId"
                    class="mt-3 rounded-2xl border border-brand/20 bg-brand/5 p-5 sm:p-6"
                    data-testid="agent-confirmation-details"
                >
                    <div>
                        <h2 class="text-sm font-semibold text-ink">
                            {{ t('workspace.agentChat.confirmTitle') }}
                        </h2>
                        <p class="mt-1 text-xs leading-5 text-muted">
                            {{ t('workspace.agentChat.confirmDescription') }}
                        </p>
                    </div>
                    <dl
                        v-guide-anchor="'onboarding.task-confirmation.key-fields'"
                        class="mt-5 grid gap-3 sm:grid-cols-2"
                        data-testid="agent-core-draft-fields"
                    >
                        <div
                            v-for="field in coreConfiguredFields"
                            :key="field.name"
                            class="rounded-xl border border-line bg-surface p-4"
                            data-testid="agent-core-draft-field"
                            :data-field-name="field.name"
                        >
                            <dt class="text-xs text-muted">
                                {{ t(field.labelKey) }}
                            </dt>
                            <dd
                                class="mt-2 whitespace-pre-wrap break-words text-sm"
                                :class="fieldValueClass(field.name)"
                            >
                                {{ formatFieldValue(resolvedField(field.name)?.value, field) }}
                            </dd>
                            <dd
                                v-if="resolvedField(field.name)"
                                class="mt-2 text-[11px] text-muted"
                            >
                                {{ t(`workspace.sources.${resolvedField(field.name)?.source}`) }}
                            </dd>
                        </div>
                    </dl>
                    <details
                        class="mt-4 rounded-xl border border-line bg-surface"
                        data-testid="agent-secondary-draft-fields"
                    >
                        <summary
                            class="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-brand"
                        >
                            {{ t('workspace.agentChat.otherFields') }}
                            <span class="ml-1 text-xs font-normal text-muted">
                                {{ t('workspace.agentChat.expandFields') }}
                            </span>
                        </summary>
                        <div class="border-t border-line p-4"></div>
                    </details>
                    <div class="mt-5 flex flex-col justify-end gap-3 sm:flex-row">
                        <button
                            v-guide-anchor="'onboarding.task-confirmation.start-analysis'"
                            class="rounded-xl bg-brand px-6 py-3 text-sm font-semibold text-on-brand transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
                            type="button"
                            data-primary-action="submit"
                            :disabled="submitting || checkingStorage"
                            @click="submitDraft"
                        >
                            {{
                                checkingStorage
                                    ? t('workspace.storage.checking')
                                    : submitting
                                        ? t('workspace.submitting')
                                        : submissionActionLabel
                            }}
                        </button>
                    </div>
                </div>
            </Transition>
        </div>
    </div>
</template>
