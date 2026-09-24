<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import InlineFeedback from '@/components/feedback/InlineFeedback.vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import ToastMessage from '@/components/ToastMessage.vue'
import AnalysisImageUpload from './AnalysisImageUpload.vue'
import AnalysisContentKindSelector from './AnalysisContentKindSelector.vue'
import AnalysisVideoUpload from './AnalysisVideoUpload.vue'
import { analysisUiConstraints } from './analysis.constants'
import { useAnalysisComposerContext } from './analysisComposer.context'
import { useAttachmentTransfer } from './useAttachmentTransfer'
import { isDraftMediaPreparing } from './taskDraft'

const props = defineProps<{
    visible: boolean
}>()
const { t } = useI18n()
const composerInput = ref<HTMLTextAreaElement | null>(null)
const sendValidationToastMessage = ref('')
const sendAttemptPending = ref(false)
let sendValidationToastTimer: number | null = null
const {
    agentInteractionMode,
    operationsLocked,
    conversationSyncMessage,
    conversationTokenBudget,
    conversationAuthorityPending,
    agentSendAvailable,
    taskConfig,
    imageUploadLimits,
    videoUnavailableMessage,
    draft,
    mediaRequirement,
    draftPreview,
    previewing,
    submitting,
    checkingStorage,
    formError,
    agentMessages,
    agentComposerText,
    canRequestAnalysis,
    canSubmit,
    submissionHint,
    accessBlockMessage,
    updateContentKind,
    updateDraftImages,
    uploadDraftImages,
    retryDraftImage,
    updateDraftCover,
    updateDraftVideo,
    clearDraftMediaAfterUploadLimit,
    updateAgentComposerText,
    sendAgentTurn,
} = useAnalysisComposerContext()

const imageUpload = ref<InstanceType<typeof AnalysisImageUpload> | null>(null)
const videoUpload = ref<InstanceType<typeof AnalysisVideoUpload> | null>(null)
const { isDragging, onPaste, onDragOver, onDragLeave, onDrop } = useAttachmentTransfer({
    isLocked: () =>
        !taskConfig.value || isSendPending.value || submitting.value || checkingStorage.value,
    isVideo: () => draft.contentKind === 'video',
    addImages: async (files) => {
        await imageUpload.value?.acceptFiles(files)
    },
    addVideo: async (files) => {
        await videoUpload.value?.acceptFiles(files)
    },
    onError: () => {
        formError.value = t('workspace.upload.transferFailed')
    },
})

const hasUserMessage = computed(() =>
    agentMessages.value.some((message) => message.role === 'user'),
)
const composerMaxLength = analysisUiConstraints.rawTextMaxLength
const composerPlaceholder = computed(() => {
    if (draftPreview.value) {
        return t('workspace.agentChat.adjustPlaceholder')
    }
    if (draft.contentKind === 'video') {
        return t('workspace.videoNotePlaceholder')
    }
    return t('workspace.rawTextPlaceholder')
})
const composerHint = computed(() =>
    draft.contentKind === 'video' ? '' : t('workspace.agentChat.inputHint'),
)
const hasSendContent = computed(
    () =>
        Boolean(agentComposerText.value.trim()) ||
        (!hasUserMessage.value &&
            Boolean(draft.rawText.trim() || draft.images.length || draft.video)),
)
const mediaPreparing = computed(() => isDraftMediaPreparing(draft))
const hasStoppedVideo = computed(
    () => draft.contentKind === 'video' && draft.video?.status === 'upload_paused',
)
const canAttemptMediaSend = computed(
    () => canRequestAnalysis.value && (mediaPreparing.value || hasStoppedVideo.value),
)
const canSend = computed(
    () =>
        (canSubmit.value || canAttemptMediaSend.value) &&
        agentSendAvailable.value &&
        (hasSendContent.value || mediaPreparing.value || hasStoppedVideo.value) &&
        !previewing.value &&
        !sendAttemptPending.value &&
        !conversationAuthorityPending.value &&
        !submitting.value &&
        !checkingStorage.value &&
        !accessBlockMessage.value,
)
const isSendPending = computed(
    () =>
        operationsLocked.value ||
        sendAttemptPending.value ||
        previewing.value ||
        conversationAuthorityPending.value,
)
const tokenProgressColor = computed(() => {
    switch (conversationTokenBudget.value?.tone) {
        case 'red':
            return 'bg-red-500'
        case 'yellow':
            return 'bg-amber-400'
        default:
            return 'bg-emerald-500'
    }
})

/** 把聊天输入同步到现有草稿或一轮澄清答案。 */
function handleComposerInput(event: Event) {
    updateAgentComposerText((event.target as HTMLTextAreaElement).value)
}

function showSendValidationToast(message: string) {
    sendValidationToastMessage.value = message
    if (sendValidationToastTimer !== null) {
        window.clearTimeout(sendValidationToastTimer)
    }
    sendValidationToastTimer = window.setTimeout(() => {
        sendValidationToastMessage.value = ''
        sendValidationToastTimer = null
    }, analysisUiConstraints.actionToastDurationMs)
}

function scrollConversationToBottom() {
    void nextTick(() => {
        document
            .querySelector<HTMLElement>('[data-testid="analysis-conversation-log"]')
            ?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    })
}

async function handleSendAttempt() {
    scrollConversationToBottom()
    if (sendAttemptPending.value) return
    if (hasStoppedVideo.value) {
        showSendValidationToast(t('workspace.agentChat.removeStoppedVideo'))
        return
    }
    if (mediaPreparing.value) {
        showSendValidationToast(t('workspace.agentChat.mediaPreparationPending'))
        return
    }
    sendAttemptPending.value = true
    try {
        await sendAgentTurn()
    } finally {
        sendAttemptPending.value = false
    }
}

onBeforeUnmount(() => {
    if (sendValidationToastTimer !== null) {
        window.clearTimeout(sendValidationToastTimer)
    }
})

watch(hasStoppedVideo, (stopped) => {
    if (stopped) return
    sendValidationToastMessage.value = ''
    if (sendValidationToastTimer !== null) {
        window.clearTimeout(sendValidationToastTimer)
        sendValidationToastTimer = null
    }
})

watch(
    () => props.visible,
    async (visible) => {
        if (!visible) {
            return
        }
        if (!draftPreview.value && draft.rawText !== agentComposerText.value) {
            agentComposerText.value = draft.rawText
        }
        await nextTick()
        composerInput.value?.focus()
    },
)
</script>

<template>
    <form
        v-if="visible"
        class="order-2 shrink-0 rounded-3xl border border-line bg-surface p-4 shadow-sm sm:p-5"
        :aria-label="t('workspace.agentChat.composerLabel')"
        :data-agent-interaction-mode="agentInteractionMode"
        :class="isDragging ? 'ring-2 ring-brand bg-brand/5' : ''"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
        @submit.prevent="handleSendAttempt"
    >
        <p
            v-if="conversationSyncMessage"
            class="mb-3 text-sm text-red-700 dark:text-red-200"
            role="status"
            data-testid="conversation-sync-status"
        >
            {{ conversationSyncMessage }}
        </p>
        <p v-if="isDragging" class="mb-3 text-sm font-semibold text-brand" role="status">
            {{ t('workspace.upload.dropHere') }}
        </p>
        <div class="flex flex-wrap items-center justify-between gap-3">
            <label class="text-sm font-semibold text-ink" for="analysis-raw-text">
                {{ t('workspace.agentChat.replyLabel') }}
            </label>
            <span
                class="analysis-engine-badge relative isolate inline-flex max-w-full items-center overflow-hidden rounded-full border border-brand/30 px-3 py-1 text-xs font-semibold text-brand"
                data-testid="analysis-engine-badge"
            >
                <span class="analysis-engine-shader" aria-hidden="true">
                    <i class="analysis-engine-bloom"></i>
                    <i class="analysis-engine-sheen" data-engine-sheen></i>
                    <i class="analysis-engine-edge"></i>
                    <i
                        v-for="particle in 5"
                        :key="particle"
                        class="analysis-engine-particle"
                        data-engine-particle
                    ></i>
                </span>
                <span class="analysis-engine-text relative z-10">
                    {{ t('workspace.analysisEngineName') }}
                </span>
            </span>
        </div>

        <div
            class="mt-3 grid min-w-0 gap-4"
            :class="
                taskConfig
                    ? draft.contentKind === 'video'
                        ? 'xl:h-44 xl:grid-cols-6 xl:items-stretch'
                        : 'xl:h-44 xl:grid-cols-3 xl:items-stretch'
                    : ''
            "
            data-testid="agent-composer-layout"
        >
            <div
                v-if="taskConfig"
                v-guide-anchor="'onboarding.workspace.options'"
                class="min-w-0 rounded-2xl border border-brand/30 bg-brand/5 p-3"
                data-testid="agent-composer-controls"
                :class="draft.contentKind === 'video' ? 'xl:col-span-2' : ''"
            >
                <div
                    class="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]"
                    data-testid="agent-composer-options"
                >
                    <AnalysisContentKindSelector
                        :model-value="draft.contentKind"
                        :video-enabled="taskConfig.uploads.videoEnabled"
                        :video-unavailable-message="videoUnavailableMessage"
                        :disabled="isSendPending"
                        embedded
                        @update:model-value="updateContentKind"
                    />
                </div>

                <InlineFeedback
                    v-if="conversationTokenBudget?.exhausted"
                    class="mt-3"
                    :feedback="{
                        key: 'analysis.agent-composer.budget',
                        scope: 'form',
                        tone: 'warning',
                        message: t('workspace.checkupInput.budgetExhausted'),
                        announce: 'polite',
                    }"
                />
            </div>

            <div
                v-if="taskConfig"
                class="h-44 min-h-0 min-w-0 overflow-y-auto overscroll-contain xl:overflow-visible"
                :class="
                    draft.contentKind === 'video'
                        ? 'grid grid-cols-2 grid-rows-[minmax(0,1fr)] gap-4 xl:col-span-2 xl:grid-cols-[subgrid]'
                        : 'flex flex-col'
                "
                data-testid="agent-composer-media"
            >
                <div
                    v-if="imageUploadLimits"
                    class="flex min-h-0 min-w-0 flex-1 flex-col"
                    :data-testid="
                        draft.contentKind === 'video' ? 'note-cover-upload' : 'note-image-upload'
                    "
                >
                    <p
                        v-if="draft.contentKind === 'video'"
                        class="mb-2 text-xs font-semibold text-ink xl:hidden"
                    >
                        {{ t('workspace.checkupInput.videoCover') }}
                    </p>
                    <AnalysisImageUpload
                        ref="imageUpload"
                        :invalid="mediaRequirement.coverInvalid"
                        :images="draft.images"
                        :upload-draft-images="uploadDraftImages"
                        :retry-draft-image="retryDraftImage"
                        :first-only="draft.contentKind === 'video'"
                        :limits="imageUploadLimits"
                        :cover-selectable="draft.contentKind === 'image'"
                        :cover-local-id="draft.coverLocalId"
                        :mutation-locked="isSendPending || submitting || checkingStorage"
                        compact
                        :stacked="draft.contentKind === 'video'"
                        @update:images="updateDraftImages"
                        @update:cover="updateDraftCover"
                        @draft-reset-required="clearDraftMediaAfterUploadLimit"
                        @error="formError = $event"
                    />
                </div>

                <div
                    v-show="draft.contentKind === 'video'"
                    class="flex min-h-0 min-w-0 flex-col"
                    data-testid="note-video-upload"
                >
                    <p class="mb-2 text-xs font-semibold text-ink xl:hidden">
                        {{ t('workspace.contentKind.video') }}
                    </p>
                    <AnalysisVideoUpload
                        ref="videoUpload"
                        :invalid="mediaRequirement.videoInvalid"
                        stacked
                        compact
                        :video="draft.video"
                        :limits="taskConfig.uploads.video"
                        :mutation-locked="isSendPending || submitting || checkingStorage || Boolean(videoUnavailableMessage)"
                        @update:video="updateDraftVideo"
                        @draft-reset-required="clearDraftMediaAfterUploadLimit"
                        @error="formError = $event"
                    />
                </div>

                <InlineFeedback
                    v-if="formError"
                    class="mt-3 sm:col-span-full"
                    :feedback="{
                        key: 'analysis.agent-composer.form',
                        scope: 'form',
                        tone: 'error',
                        message: formError,
                        announce: 'assertive',
                    }"
                />
            </div>

            <div
                v-guide-anchor="'onboarding.workspace.agent-input'"
                class="flex h-44 min-h-0 min-w-0 flex-col"
                :class="!taskConfig || draft.contentKind === 'video' ? 'xl:col-span-2' : ''"
                data-testid="agent-composer-message"
            >
                <div
                    v-guide-anchor="'onboarding.agent-reply.free-input'"
                    class="flex min-h-0 flex-1 items-end gap-2 rounded-2xl border border-line bg-canvas p-2 transition focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15"
                >
                    <textarea
                        id="analysis-raw-text"
                        ref="composerInput"
                        class="h-full min-h-0 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-2 py-2 text-sm leading-6 text-ink outline-none placeholder:text-muted/70"
                        :value="agentComposerText"
                        :placeholder="composerPlaceholder"
                        :maxlength="composerMaxLength"
                        :disabled="isSendPending"
                        @paste="onPaste"
                        @input="handleComposerInput"
                    ></textarea>
                    <div class="flex shrink-0 flex-col items-center justify-end gap-1">
                        <div
                            v-if="conversationTokenBudget"
                            class="w-12 text-center"
                            data-testid="conversation-token-progress"
                            role="progressbar"
                            :aria-label="t('workspace.agentChat.tokenProgress')"
                            aria-valuemin="0"
                            aria-valuemax="100"
                            :aria-valuenow="conversationTokenBudget.percentage"
                            :title="`${t('workspace.agentChat.tokenProgress')} ${conversationTokenBudget.percentage}%`"
                        >
                            <span class="text-[11px] font-semibold tabular-nums text-ink">
                                {{ conversationTokenBudget.percentage }}%
                            </span>
                            <span class="mt-1 block h-1.5 overflow-hidden rounded-full bg-line">
                                <span
                                    class="block h-full rounded-full transition-[width,background-color]"
                                    :class="tokenProgressColor"
                                    :style="{ width: `${conversationTokenBudget.percentage}%` }"
                                ></span>
                            </span>
                        </div>
                        <button
                            class="flex h-11 shrink-0 items-center justify-center rounded-xl bg-brand text-sm font-semibold text-on-brand transition-all hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
                            :class="isSendPending ? 'min-w-24 px-4' : 'w-11'"
                            type="submit"
                            data-primary-action="send"
                            :aria-label="
                                isSendPending
                                    ? conversationSyncMessage
                                        ? t('workspace.agentChat.disconnected')
                                        : t('workspace.agentChat.waiting')
                                    : t('workspace.agentChat.send')
                            "
                            :disabled="!canSend"
                        >
                            <span v-if="isSendPending">{{
                                conversationSyncMessage
                                    ? t('workspace.agentChat.disconnected')
                                    : t('workspace.agentChat.waiting')
                            }}</span>
                            <AppIcon v-else name="send" />
                        </button>
                    </div>
                </div>

                <InlineFeedback
                    v-if="!taskConfig && formError"
                    class="mt-3"
                    :feedback="{
                        key: 'analysis.agent-composer.form',
                        scope: 'form',
                        tone: 'error',
                        message: formError,
                        announce: 'assertive',
                    }"
                />

                <InlineFeedback
                    v-if="accessBlockMessage && hasSendContent"
                    class="mt-3"
                    :feedback="{
                        key: 'analysis.agent-composer.access',
                        scope: 'form',
                        tone: 'warning',
                        message: accessBlockMessage,
                        announce: 'polite',
                    }"
                />

                <div
                    class="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted"
                >
                    <span v-if="composerHint">{{ composerHint }}</span>
                    <span v-if="submissionHint" class="font-semibold text-ink">
                        {{ submissionHint }}
                    </span>
                    <span>
                        {{ agentComposerText.length }} /
                        {{ composerMaxLength }}
                    </span>
                </div>
            </div>
        </div>

        <ToastMessage
            :visible="Boolean(sendValidationToastMessage)"
            :message="sendValidationToastMessage"
        />
    </form>
</template>

<style scoped>
.analysis-engine-badge {
    background-image: linear-gradient(
        110deg,
        rgb(var(--color-surface-muted) / 0.9),
        rgb(var(--color-brand) / 0.09) 46%,
        rgb(var(--color-surface) / 0.88)
    );
    box-shadow:
        inset 0 1px 0 rgb(var(--color-brand-glow) / 0.2),
        inset 0 -1px 0 rgb(var(--color-brand) / 0.12),
        0 0.35rem 1rem rgb(var(--color-brand) / 0.08);
    backdrop-filter: blur(0.75rem) saturate(1.18);
}

.analysis-engine-shader {
    position: absolute;
    inset: 0;
    overflow: hidden;
    border-radius: inherit;
}

.analysis-engine-bloom {
    position: absolute;
    top: -130%;
    left: -18%;
    width: 68%;
    height: 350%;
    border-radius: 50%;
    background: radial-gradient(
        ellipse at center,
        rgb(var(--color-brand-glow) / 0.22),
        rgb(var(--color-brand) / 0.08) 42%,
        transparent 70%
    );
    filter: blur(0.3rem);
    animation: analysis-engine-bloom-drift 5s ease-in-out infinite alternate;
}

.analysis-engine-sheen {
    position: absolute;
    top: -80%;
    bottom: -80%;
    left: -42%;
    width: 38%;
    transform: skewX(-22deg);
    background: linear-gradient(
        90deg,
        transparent,
        rgb(var(--color-brand-glow) / 0.08) 20%,
        rgb(var(--color-brand-glow) / 0.62) 48%,
        rgb(var(--color-surface) / 0.6) 56%,
        rgb(var(--color-brand) / 0.12) 72%,
        transparent
    );
    filter: blur(0.12rem);
    animation: analysis-engine-sheen-sweep 3.6s cubic-bezier(0.22, 0.65, 0.36, 1) infinite;
}

.analysis-engine-edge {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    box-shadow:
        inset 0 1px 0 rgb(var(--color-brand-glow) / 0.28),
        inset 0 -0.35rem 0.65rem rgb(var(--color-brand) / 0.07);
}

.analysis-engine-text {
    text-shadow: 0 0 0.55rem rgb(var(--color-brand) / 0.24);
}

.analysis-engine-particle {
    position: absolute;
    top: 50%;
    width: 0.22rem;
    height: 0.22rem;
    border-radius: 9999px;
    background: rgb(var(--color-brand-glow) / 0.72);
    box-shadow: 0 0 0.55rem rgb(var(--color-brand-glow) / 0.48);
    opacity: 0.14;
    animation: analysis-engine-particle-drift 4.4s ease-in-out infinite alternate;
}

.analysis-engine-particle:nth-of-type(4) {
    left: 12%;
    --particle-y: -0.35rem;
    animation-delay: -0.8s;
}

.analysis-engine-particle:nth-of-type(5) {
    left: 31%;
    --particle-y: 0.25rem;
    animation-delay: -2.1s;
}

.analysis-engine-particle:nth-of-type(6) {
    left: 54%;
    --particle-y: -0.2rem;
    animation-delay: -1.4s;
}

.analysis-engine-particle:nth-of-type(7) {
    left: 72%;
    --particle-y: 0.3rem;
    animation-delay: -3.2s;
}

.analysis-engine-particle:nth-of-type(8) {
    left: 89%;
    --particle-y: -0.28rem;
    animation-delay: -2.6s;
}

@keyframes analysis-engine-sheen-sweep {
    0%,
    18% {
        transform: translateX(0) skewX(-22deg);
        opacity: 0;
    }
    28% {
        opacity: 1;
    }
    62%,
    to {
        transform: translateX(430%) skewX(-22deg);
        opacity: 0;
    }
}

@keyframes analysis-engine-bloom-drift {
    to {
        transform: translateX(72%);
        opacity: 0.7;
    }
}

@keyframes analysis-engine-particle-drift {
    from {
        transform: translate3d(-0.22rem, var(--particle-y), 0) scale(0.72);
        opacity: 0.1;
    }
    to {
        transform: translate3d(0.3rem, calc(-1 * var(--particle-y)), 0) scale(1.12);
        opacity: 0.5;
    }
}

@media (prefers-reduced-motion: reduce) {
    .analysis-engine-bloom,
    .analysis-engine-sheen,
    .analysis-engine-particle {
        animation: none;
    }

    .analysis-engine-sheen,
    .analysis-engine-particle {
        display: none;
    }
}
</style>
