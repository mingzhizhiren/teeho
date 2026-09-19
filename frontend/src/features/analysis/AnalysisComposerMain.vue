<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import InlineFeedback from '@/components/feedback/InlineFeedback.vue'
import AnalysisDraftPreview from './AnalysisDraftPreview.vue'
import AnalysisContentKindSelector from './AnalysisContentKindSelector.vue'
import AnalysisImageUpload from './AnalysisImageUpload.vue'
import AnalysisVideoUpload from './AnalysisVideoUpload.vue'
import ConfiguredTaskField from './ConfiguredTaskField.vue'
import type { AnalysisInputMode } from './analysis.contract'
import { useAnalysisComposerContext } from './analysisComposer.context'
import { activeDraftImages, areDraftImagesReady, isDraftVideoReady } from './taskDraft'

defineProps<{
    activeView: AnalysisInputMode | 'result'
}>()
const { t } = useI18n()
const {
    taskConfig,
    imageUploadLimits,
    videoUnavailableMessage,
    draft,
    mediaRequirement,
    mediaRequirementMessage,
    previewing,
    submitting,
    checkingStorage,
    formError,
    canRequestAnalysis,
    canSubmit,
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
    previewDraft,
    submitDraft,
} = useAnalysisComposerContext()
const uploadedMaterialsReady = computed(
    () =>
        areDraftImagesReady(activeDraftImages(draft)) &&
        (draft.contentKind !== 'video' || !draft.video || isDraftVideoReady(draft.video)),
)
</script>

<template>
    <div v-if="activeView === 'agent'" class="mt-7">
        <AnalysisDraftPreview />
        <p
            v-if="mediaRequirementMessage"
            class="sticky bottom-0 z-10 mt-6 bg-surface py-2 text-center text-sm font-semibold text-red-600 dark:text-red-400"
            role="status"
            data-testid="analysis-media-requirement"
        >
            {{ mediaRequirementMessage }}
        </p>
    </div>

    <form v-else-if="activeView === 'custom'" class="mt-7" @submit.prevent="submitDraft">
        <div
            class="rounded-2xl border border-line bg-surface-muted p-5 sm:p-6"
            data-testid="custom-analysis-form"
        >
            <div
                v-if="taskConfig"
                v-guide-anchor="'onboarding.expert-mode.options'"
                class="grid gap-4 xl:grid-cols-4"
                data-testid="custom-analysis-primary-row"
            >
                <div
                    class="grid min-w-0 content-start gap-4 rounded-2xl border border-brand/30 bg-brand/5 p-3 md:grid-cols-2 xl:col-span-2"
                    data-testid="custom-analysis-options"
                >
                    <AnalysisContentKindSelector
                        embedded
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
                            :invalid="mediaRequirement.coverInvalid"
                            :stacked="draft.contentKind === 'video'"
                            :images="draft.images"
                            :upload-draft-images="uploadDraftImages"
                            :retry-draft-image="retryDraftImage"
                            :first-only="draft.contentKind === 'video'"
                            :limits="imageUploadLimits"
                            :cover-selectable="draft.contentKind === 'image'"
                            :cover-local-id="draft.coverLocalId"
                            :mutation-locked="previewing || submitting || checkingStorage"
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
                        </p>
                        <AnalysisVideoUpload
                            :invalid="mediaRequirement.videoInvalid"
                            stacked
                            :video="draft.video"
                            :limits="taskConfig.uploads.video"
                            :mutation-locked="previewing || submitting || checkingStorage || Boolean(videoUnavailableMessage)"
                            @update:video="updateDraftVideo"
                            @draft-reset-required="clearDraftMediaAfterUploadLimit"
                            @error="formError = $event"
                        />
                    </div>
                </div>
            </div>

            <div
                v-guide-anchor="'onboarding.expert-mode.core-fields'"
                class="mt-6 grid gap-5"
                data-testid="custom-core-fields"
            >
                <ConfiguredTaskField
                    v-for="field in coreConfiguredFields"
                    :key="field.name"
                    :field="field"
                    :model-value="draft.fields[field.name]"
                    :resolved-field="resolvedField(field.name)"
                    @update:model-value="updateDraftField(field.name, $event)"
                />
            </div>

            <InlineFeedback
                v-if="formError"
                class="mt-5"
                :feedback="{
                    key: 'analysis.custom-composer.form',
                    scope: 'form',
                    tone: 'error',
                    message: formError,
                    announce: 'assertive',
                }"
            />

            <div class="mt-6 flex flex-col justify-end gap-3 sm:flex-row">
                <span
                    v-if="submissionHint"
                    class="mr-auto self-center text-xs font-semibold text-muted"
                >
                    {{ submissionHint }}
                </span>
                <button
                    class="rounded-xl border border-line bg-surface px-5 py-3 text-sm font-semibold text-ink transition hover:border-brand/50 hover:bg-brand/5 disabled:cursor-not-allowed disabled:opacity-50"
                    type="button"
                    :disabled="!canSubmit || previewing || submitting"
                    @click="previewDraft"
                >
                    {{
                        previewing
                            ? t('workspace.checkupInput.previewing')
                            : t('workspace.checkupInput.preview')
                    }}
                </button>
                <button
                    v-guide-anchor="'onboarding.expert-mode.start-analysis'"
                    class="rounded-xl bg-brand px-7 py-3 text-sm font-semibold text-on-brand transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
                    type="submit"
                    data-primary-action="submit"
                    :disabled="
                        !canRequestAnalysis ||
                            !uploadedMaterialsReady ||
                            submitting ||
                            previewing ||
                            checkingStorage
                    "
                >
                    {{
                        checkingStorage
                            ? t('workspace.storage.checking')
                            : submitting
                                ? t('workspace.submitting')
                                : t('workspace.submit')
                    }}
                </button>
            </div>
        </div>
    </form>
</template>
