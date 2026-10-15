<script setup lang="ts">
import AppButton from '@/components/AppButton.vue'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import InlineFeedback from '@/components/feedback/InlineFeedback.vue'
import ToastMessage from '@/components/ToastMessage.vue'
import AppConfirmDialog from '@/components/AppConfirmDialog.vue'
import { useOnboardingBlocker } from '@/features/onboarding/useOnboardingBlocker'
import { analysisUiConstraints } from './analysis.constants'
import {
    buildNoteTemplate,
    parseNoteTemplate,
    type NoteTemplateFields,
} from './analysis.note-template'
import { useAnalysisComposerContext } from './analysisComposer.context'
import { getDraftFieldIssue } from './taskDraft'

defineProps<{ hasDraftContent: boolean }>()
const emit = defineEmits<{ 'clear-draft': [] }>()

const { t } = useI18n()
const { operationsLocked, taskConfig, draft, replaceNoteFields, formError } =
    useAnalysisComposerContext()
const copying = ref(false)
const copied = ref(false)
const pasting = ref(false)
const manualError = ref('')
const pendingFields = ref<NoteTemplateFields | null>(null)
const overwriteOpen = ref(false)
const manualOpen = ref(false)
const manualText = ref('')
const error = computed({
    get: () => (manualOpen.value ? manualError.value : formError.value),
    set: (message: string) => {
        if (manualOpen.value) manualError.value = message
        else formError.value = message
    },
})
watch(manualOpen, () => {
    manualError.value = ''
})
watch(
    [() => draft.fields.title, () => draft.fields.body, () => draft.fields.topics, manualText],
    () => {
        error.value = ''
    },
    { deep: true },
)
const hasExistingText = computed(() =>
    ['title', 'body', 'topics'].some((name) => {
        const value = draft.fields[name as 'title' | 'body' | 'topics']
        return Array.isArray(value)
            ? value.some((topic) => topic.trim())
            : typeof value === 'string' && Boolean(value.trim())
    }),
)
useOnboardingBlocker(
    computed(() => overwriteOpen.value || manualOpen.value),
    'business_dialog',
)
let noticeTimer: ReturnType<typeof setTimeout> | undefined
let disposed = false

async function copyTemplate(): Promise<void> {
    if (copying.value || pasting.value || operationsLocked.value) return
    copying.value = true
    error.value = ''
    copied.value = false
    clearTimeout(noticeTimer)
    try {
        await navigator.clipboard.writeText(
            buildNoteTemplate({
                title: t('workspace.noteTemplate.titlePlaceholder'),
                body: t('workspace.noteTemplate.bodyPlaceholder'),
                multiline: t('workspace.noteTemplate.multilinePlaceholder'),
                topics: t('workspace.noteTemplate.topicsPlaceholder'),
            }),
        )
        if (disposed) return
        copied.value = true
        noticeTimer = setTimeout(() => {
            copied.value = false
        }, analysisUiConstraints.actionToastDurationMs)
    } catch {
        if (!disposed) error.value = t('workspace.noteTemplate.copyFailed')
    } finally {
        if (!disposed) copying.value = false
    }
}

async function pasteTemplate(): Promise<void> {
    if (pasting.value || copying.value || operationsLocked.value) return
    pasting.value = true
    error.value = ''
    try {
        const text = await navigator.clipboard.readText()
        if (disposed) return
        await importTemplateText(text)
    } catch {
        if (!disposed) manualOpen.value = true
    } finally {
        if (!disposed) pasting.value = false
    }
}

async function importTemplateText(text: string): Promise<void> {
    error.value = ''
    const result = parseNoteTemplate(text)
    if (result.status === 'invalid') {
        error.value = t(`workspace.noteTemplate.errors.${result.reason}`)
        return
    }
    if (!validateImportFields(result.fields)) return
    if (hasExistingText.value) {
        pendingFields.value = result.fields
        manualOpen.value = false
        await nextTick()
        if (!disposed) overwriteOpen.value = true
    } else {
        await replaceNoteFields(result.fields)
        manualOpen.value = false
        manualText.value = ''
    }
}

function validateImportFields(fields: NoteTemplateFields): boolean {
    const config = taskConfig.value
    if (!config) return false
    const issue = getDraftFieldIssue({ ...draft, fields: { ...draft.fields, ...fields } }, config, {
        allowIncomplete: true,
    })
    if (!issue) return true
    error.value = t(`workspace.checkupInput.${issue.reason}`, {
        field: t(issue.field.labelKey),
        limit: issue.limit,
    })
    return false
}

async function importManualText(): Promise<void> {
    if (pasting.value || operationsLocked.value) return
    pasting.value = true
    try {
        await importTemplateText(manualText.value)
    } finally {
        if (!disposed) pasting.value = false
    }
}

async function confirmOverwrite(): Promise<void> {
    const fields = pendingFields.value
    if (!fields || pasting.value || operationsLocked.value) return
    if (!validateImportFields(fields)) {
        overwriteOpen.value = false
        return
    }
    pasting.value = true
    try {
        await replaceNoteFields(fields)
        pendingFields.value = null
        overwriteOpen.value = false
        manualText.value = ''
    } finally {
        pasting.value = false
    }
}

onBeforeUnmount(() => {
    disposed = true
    clearTimeout(noticeTimer)
})
</script>

<template>
    <div class="flex max-w-full flex-col items-end gap-2">
        <div class="flex flex-wrap justify-end gap-2">
            <AppButton
                v-guide-anchor="'onboarding.expert-mode.copy-template'"
                variant="secondary"
                size="md"
                icon="copy"
                :loading="copying"
                type="button"
                :disabled="operationsLocked || copying || pasting"
                @click="copyTemplate"
            >
                {{ t('workspace.noteTemplate.copy') }}
            </AppButton>
            <AppButton
                v-guide-anchor="'onboarding.expert-mode.paste-content'"
                variant="secondary"
                size="md"
                icon="file-text"
                :loading="pasting"
                type="button"
                :disabled="operationsLocked || pasting || copying"
                @click="pasteTemplate"
            >
                {{ t('workspace.noteTemplate.paste') }}
            </AppButton>
            <AppButton
                v-if="hasDraftContent"
                variant="danger"
                size="md"
                icon="trash"
                type="button"
                data-testid="clear-analysis-draft"
                :disabled="operationsLocked || copying || pasting"
                @click="emit('clear-draft')"
            >
                {{ t('workspace.formDraft.clear') }}
            </AppButton>
        </div>
        <ToastMessage :visible="copied" :message="t('workspace.noteTemplate.copied')" />
        <AppConfirmDialog
            v-model:open="manualOpen"
            :title="t('workspace.noteTemplate.manualTitle')"
            :description="t('workspace.noteTemplate.pasteFailed')"
            :confirm-label="t('workspace.noteTemplate.manualAction')"
            :cancel-label="t('common.cancel')"
            :busy="pasting"
            @confirm="importManualText"
            @cancel="error = ''"
        >
            <label for="analysis-template-input" class="block text-sm font-semibold text-ink">
                {{ t('workspace.noteTemplate.manualLabel') }}
            </label>
            <textarea
                id="analysis-template-input"
                v-model="manualText"
                class="mt-2 min-h-48 w-full resize-y rounded-xl border border-line bg-surface px-3 py-3 text-sm leading-6 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                :disabled="pasting"
                :aria-invalid="Boolean(error)"
                :aria-describedby="error ? 'analysis-template-error' : undefined"
            />
            <InlineFeedback
                v-if="error"
                id="analysis-template-error"
                class="mt-3"
                :feedback="{
                    key: 'analysis.template.manual',
                    scope: 'form',
                    tone: 'error',
                    message: error,
                    announce: 'assertive',
                }"
            />
        </AppConfirmDialog>
        <AppConfirmDialog
            v-model:open="overwriteOpen"
            :title="t('workspace.noteTemplate.overwriteTitle')"
            :description="t('workspace.noteTemplate.overwriteDescription')"
            :confirm-label="t('workspace.noteTemplate.overwriteAction')"
            :cancel-label="t('common.cancel')"
            :busy="pasting"
            @confirm="confirmOverwrite"
            @cancel="pendingFields = null"
        />
    </div>
</template>
