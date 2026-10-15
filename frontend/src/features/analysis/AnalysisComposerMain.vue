<script setup lang="ts">
import AppButton from '@/components/AppButton.vue'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import InlineFeedback from '@/components/feedback/InlineFeedback.vue'
import AnalysisContentKindSelector from './AnalysisContentKindSelector.vue'
import AnalysisImageUpload from './AnalysisImageUpload.vue'
import AnalysisVideoUpload from './AnalysisVideoUpload.vue'
import ConfiguredTaskField from './ConfiguredTaskField.vue'
import { useAnalysisComposerContext } from './analysisComposer.context'
import { useAttachmentTransfer } from './useAttachmentTransfer'

defineProps<{
    activeView: 'custom' | 'result'
}>()
const { t } = useI18n()
const {
    recoveredInput,
    operationsLocked,
    taskConfig,
    imageUploadLimits,
    videoUnavailableMessage,
    draft,
    mediaRequirement,
    submitting,
    checkingStorage,
    formError,
    editNotice,
    submissionHint,
    coreConfiguredFields,
    resolvedField,
    updateDraftField,
    updateContentKind,
    updateDraftImages,
    uploadDraftImages,
    retryDraftImage,
    updateDraftCover,
    updateDraftVideo,
    clearDraftMediaAfterUploadLimit,
    submitDraft,
} = useAnalysisComposerContext()
const imageUpload = ref<InstanceType<typeof AnalysisImageUpload> | null>(null)
const videoUpload = ref<InstanceType<typeof AnalysisVideoUpload> | null>(null)
const { isDragging, onPaste, onDragOver, onDragLeave, onDrop } = useAttachmentTransfer({
    isLocked: () => operationsLocked.value || !taskConfig.value,
    isVideo: () => draft.contentKind === 'video',
    addImages: async (files) => {
        await imageUpload.value?.acceptFiles(files)
    },
    addVideo: async (files) => {
        await videoUpload.value?.acceptFiles(files)
    },
    onError: () => {
        formError.value = t('workspace.genericError')
    },
})
</script>

<template>
    <form
        v-if="activeView === 'custom'"
        class="ui-analysis-form mt-7"
        @submit.prevent="submitDraft"
        @paste="onPaste"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
    >
        <section
            v-if="recoveredInput"
            class="mb-5 min-w-0 rounded-2xl border border-line bg-surface p-4"
            aria-labelledby="recovered-input-label"
        >
            <label
                id="recovered-input-label"
                for="recovered-input"
                class="text-sm font-semibold text-ink"
            >
                {{ t('workspace.formDraft.recoveredInput') }}
            </label>
            <p id="recovered-input-help" class="mt-2 text-sm leading-6 text-muted">
                {{ t('workspace.formDraft.recoveredInputHelp') }}
            </p>
            <textarea
                id="recovered-input"
                :value="recoveredInput"
                readonly
                rows="5"
                aria-describedby="recovered-input-help"
                class="mt-3 block w-full min-w-0 rounded-xl border border-line bg-surface-muted p-3 text-sm leading-6 text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            />
        </section>
        <InlineFeedback
            v-if="editNotice"
            class="mb-5"
            data-testid="analysis-edit-notice"
            :feedback="{
                key: 'analysis.edit.media',
                scope: 'form',
                tone: 'warning',
                message: editNotice,
            }"
        />
        <div
            class="min-w-0 pt-2"
            :class="isDragging ? 'ring-2 ring-brand/50' : ''"
            data-testid="custom-analysis-form"
        >
            <div
                v-if="taskConfig"
                v-guide-anchor="'onboarding.expert-mode.options'"
                class="grid gap-4 xl:grid-cols-4"
                data-testid="custom-analysis-primary-row"
            >
                <div
                    class="ui-form-options grid min-w-0 content-start gap-4 rounded-2xl bg-surface-muted p-4 md:grid-cols-2 xl:col-span-2"
                    data-testid="custom-analysis-options"
                >
                    <AnalysisContentKindSelector
                        embedded
                        :disabled="operationsLocked"
                        :model-value="draft.contentKind"
                        :video-enabled="taskConfig.uploads.videoEnabled"
                        :video-unavailable-message="videoUnavailableMessage"
                        @update:model-value="updateContentKind"
                    />
                </div>

                <div
                    v-guide-anchor="'onboarding.expert-mode.media'"
                    class="min-w-0 xl:col-span-2"
                    :class="
                        draft.contentKind === 'video'
                            ? 'grid gap-4 sm:grid-cols-2 xl:grid-cols-[subgrid]'
                            : ''
                    "
                    data-testid="custom-analysis-media"
                >
                    <p
                        v-if="draft.contentKind !== 'video'"
                        class="mb-2 text-xs font-semibold text-ink"
                    >
                        {{ t('workspace.customMaterials') }}
                        <span class="ml-1 text-red-600 dark:text-red-400" aria-hidden="true"
                        >*</span
                        >
                    </p>
                    <p
                        v-if="draft.contentKind !== 'video'"
                        class="mb-3 text-xs leading-5 text-muted"
                    >
                        {{ t('workspace.checkupInput.coverHint') }}
                    </p>
                    <div
                        v-if="imageUploadLimits"
                        class="min-w-0"
                        :data-testid="
                            draft.contentKind === 'video'
                                ? 'note-cover-upload'
                                : 'note-image-upload'
                        "
                    >
                        <p
                            v-if="draft.contentKind === 'video'"
                            class="mb-2 text-xs font-semibold text-ink"
                        >
                            {{ t('workspace.checkupInput.videoCover') }}
                        </p>
                        <AnalysisImageUpload
                            ref="imageUpload"
                            :invalid="mediaRequirement.coverInvalid"
                            :stacked="draft.contentKind === 'video'"
                            :images="draft.images"
                            :upload-draft-images="uploadDraftImages"
                            :retry-draft-image="retryDraftImage"
                            :first-only="draft.contentKind === 'video'"
                            :limits="imageUploadLimits"
                            :cover-selectable="draft.contentKind === 'image'"
                            :cover-local-id="draft.coverLocalId"
                            :mutation-locked="operationsLocked"
                            @update:images="updateDraftImages"
                            @update:cover="updateDraftCover"
                            @draft-reset-required="clearDraftMediaAfterUploadLimit"
                            @error="formError = $event"
                        />
                    </div>

                    <div
                        v-show="draft.contentKind === 'video'"
                        class="min-w-0"
                        data-testid="note-video-upload"
                    >
                        <p class="mb-2 text-xs font-semibold text-ink">
                            {{ t('workspace.contentKind.video') }}
                            <span class="ml-1 text-red-600 dark:text-red-400" aria-hidden="true"
                            >*</span
                            >
                        </p>
                        <AnalysisVideoUpload
                            ref="videoUpload"
                            :invalid="mediaRequirement.videoInvalid"
                            stacked
                            :video="draft.video"
                            :limits="taskConfig.uploads.video"
                            :mutation-locked="operationsLocked || Boolean(videoUnavailableMessage)"
                            @update:video="updateDraftVideo"
                            @draft-reset-required="clearDraftMediaAfterUploadLimit"
                            @error="formError = $event"
                        />
                    </div>
                </div>
            </div>

            <fieldset
                v-guide-anchor="'onboarding.expert-mode.core-fields'"
                class="mt-6 grid min-w-0 gap-5 border-0"
                data-testid="custom-core-fields"
                :disabled="operationsLocked"
            >
                <ConfiguredTaskField
                    v-for="field in coreConfiguredFields"
                    :key="field.name"
                    :field="field"
                    :model-value="draft.fields[field.name]"
                    :resolved-field="resolvedField(field.name)"
                    @update:model-value="updateDraftField(field.name, $event)"
                />
            </fieldset>

            <InlineFeedback
                v-if="formError"
                class="mt-5"
                data-testid="analysis-form-error"
                :feedback="{
                    key: 'analysis.custom-composer.form',
                    scope: 'form',
                    tone: 'error',
                    message: formError,
                    announce: 'assertive',
                }"
            />

            <div
                class="mt-6 flex flex-wrap items-center justify-end gap-3"
                data-testid="analysis-form-actions"
            >
                <span
                    v-if="submissionHint"
                    class="mr-auto self-center text-xs font-semibold text-brand"
                >
                    {{ submissionHint }}
                </span>
                <div class="flex min-w-0 flex-wrap items-end justify-end gap-3">
                    <slot name="actions" />
                    <AppButton
                        v-guide-anchor="'onboarding.expert-mode.start-analysis'"
                        variant="primary"
                        size="md"
                        :loading="submitting || checkingStorage"
                        icon="sparkles"
                        type="submit"
                        data-primary-action="submit"
                        :disabled="!taskConfig || operationsLocked"
                    >
                        {{
                            checkingStorage
                                ? t('workspace.storage.checking')
                                : submitting
                                    ? t('workspace.submitting')
                                    : t('workspace.submit')
                        }}
                    </AppButton>
                </div>
            </div>
        </div>
    </form>
</template>
