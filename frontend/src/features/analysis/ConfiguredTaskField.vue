<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppListbox from '@/components/AppListbox.vue'
import { formatTopicInput, parseTopicInput } from './analysis.topic-input'
import type { ResolvedTaskField, TaskFieldDefinition, TaskFieldValue } from './analysis.contract'

const props = defineProps<{
    field: TaskFieldDefinition
    modelValue: TaskFieldValue | undefined
    resolvedField: ResolvedTaskField | null
}>()
const emit = defineEmits<{
    'update:modelValue': [value: TaskFieldValue | undefined]
}>()
const { t } = useI18n()
const tagInput = ref(Array.isArray(props.modelValue) ? formatTopicInput(props.modelValue) : '')
const isComposing = ref(false)
const isEditingTags = ref(false)

const fieldId = computed(() => `analysis-field-${props.field.name}`)
const isRequired = computed(() => ['title', 'topics'].includes(props.field.name))
const enabledOptions = computed(() => props.field.options?.filter((option) => option.enabled) ?? [])
const selectOptions = computed(() =>
    enabledOptions.value.map((option) => ({
        value: String(option.value),
        label: t(option.labelKey),
    })),
)
const inferredValue = computed(() => {
    const field = props.resolvedField
    if (!field || field.source !== 'agent_inference' || field.value === 'auto') {
        return undefined
    }
    return field.value
})
const displayValue = computed(() => {
    if (props.field.kind === 'tags') return tagInput.value
    if (Array.isArray(props.modelValue)) {
        return props.modelValue.join(', ')
    }
    if (props.modelValue !== undefined && props.modelValue !== null) {
        return String(props.modelValue)
    }
    if (Array.isArray(inferredValue.value)) {
        return inferredValue.value.join(', ')
    }
    return inferredValue.value === undefined || inferredValue.value === null
        ? ''
        : String(inferredValue.value)
})
const visibleSource = computed(() =>
    displayValue.value.length > 0 ? (props.resolvedField?.source ?? null) : null,
)
const defaultOptionLabel = computed(() => t('workspace.fields.autoPlaceholder'))
const inheritedPlaceholder = computed(() =>
    isRequired.value
        ? t(`workspace.checkupInput.${props.field.name}Placeholder`)
        : t('workspace.fields.autoPlaceholder'),
)

/** 保留话题分隔符输入过程，只在外部草稿变化时替换编辑文本。 */
watch(
    () => props.modelValue,
    (value) => {
        if (props.field.kind !== 'tags' || isComposing.value) return
        const topics = Array.isArray(value) ? value : []
        if (
            !isEditingTags.value ||
            JSON.stringify(topics) !== JSON.stringify(parseTopicInput(tagInput.value))
        ) {
            tagInput.value = formatTopicInput(topics)
        }
    },
)

function updateSelectValue(value: string) {
    emit('update:modelValue', value || undefined)
}

/** 从表单元素读取并提交字段值 */
function updateFromElement(event: Event) {
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value
    if (props.field.kind === 'tags') tagInput.value = value
    if (isComposing.value) return
    if (!value.trim()) {
        emit('update:modelValue', undefined)
        return
    }
    if (props.field.kind === 'tags') {
        const topics = parseTopicInput(value)
        if ('inputType' in event && event.inputType === 'insertFromPaste') {
            tagInput.value = formatTopicInput(topics)
        }
        emit('update:modelValue', topics)
        return
    }
    emit('update:modelValue', value)
}

/** 只在用户离开话题字段后整理显示，避免逐键移动光标。 */
function normalizeTagInput(): void {
    isEditingTags.value = false
    if (props.field.kind !== 'tags' || isComposing.value) return
    const topics = parseTopicInput(tagInput.value)
    tagInput.value = formatTopicInput(topics)
    emit('update:modelValue', topics.length ? topics : undefined)
}

function finishComposition(event: CompositionEvent): void {
    isComposing.value = false
    updateFromElement(event)
    if (!isEditingTags.value) normalizeTagInput()
}
</script>

<template>
    <div>
        <div class="flex items-center justify-between gap-3">
            <label class="text-xs font-semibold text-ink" :for="fieldId">
                {{ t(field.labelKey) }}
                <span
                    v-if="isRequired"
                    class="ml-1 text-red-600 dark:text-red-400"
                    aria-hidden="true"
                >*</span
                >
            </label>
            <span
                v-if="visibleSource && visibleSource !== 'user_input'"
                class="rounded-full bg-surface px-2 py-1 text-[11px] font-medium text-muted ring-1 ring-line"
            >
                {{ t(`workspace.sources.${visibleSource}`) }}
            </span>
        </div>

        <AppListbox
            v-if="field.kind === 'select'"
            class="mt-2"
            :input-id="fieldId"
            :model-value="displayValue"
            :options="selectOptions"
            :label="t(field.labelKey)"
            :placeholder="defaultOptionLabel"
            @update:model-value="updateSelectValue"
        />

        <textarea
            v-else-if="field.kind === 'textarea' || field.kind === 'tags'"
            :id="fieldId"
            :value="displayValue"
            class="mt-2 w-full rounded-xl border border-line bg-surface px-3 py-3 text-sm text-ink outline-none transition placeholder:text-muted/70 focus:border-brand focus:ring-2 focus:ring-brand/15"
            :class="field.kind === 'tags' ? 'topic-input' : 'min-h-[7.5rem] resize-y leading-6'"
            :rows="field.kind === 'tags' ? 1 : undefined"
            :wrap="field.kind === 'tags' ? 'off' : undefined"
            :maxlength="field.kind === 'tags' ? undefined : field.validation?.maxLength"
            :aria-required="isRequired"
            :aria-describedby="`${fieldId}-help`"
            :placeholder="inheritedPlaceholder"
            @input="updateFromElement"
            @focus="isEditingTags = true"
            @blur="normalizeTagInput"
            @compositionstart="isComposing = true"
            @compositionend="finishComposition"
            @keydown.enter="field.kind === 'tags' && !$event.isComposing && $event.preventDefault()"
        ></textarea>

        <input
            v-else
            :id="fieldId"
            :value="displayValue"
            class="mt-2 w-full rounded-xl border border-line bg-surface px-3 py-3 text-sm text-ink outline-none transition placeholder:text-muted/70 focus:border-brand focus:ring-2 focus:ring-brand/15"
            :maxlength="field.validation?.maxLength"
            :aria-required="isRequired"
            :aria-describedby="`${fieldId}-help`"
            :placeholder="inheritedPlaceholder"
            @input="updateFromElement"
        />

        <p :id="`${fieldId}-help`" class="mt-2 text-[11px] leading-5 text-muted">
            {{ t(field.helpKey) }}
        </p>
    </div>
</template>

<style scoped>
.topic-input {
    height: calc(1.25rem + 1.5rem + 2px);
    min-height: 0;
    line-height: 1.25rem;
    resize: none;
    overflow: hidden;
}
</style>
