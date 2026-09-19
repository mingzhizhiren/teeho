<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/icons/AppIcon.vue'
import LoginForm from '@/components/LoginForm.vue'

const props = withDefaults(
    defineProps<{
        modelValue: boolean
        redirectPath?: string
    }>(),
    {
        redirectPath: '/workspace',
    },
)

const emit = defineEmits<{
    'update:modelValue': [value: boolean]
}>()

const { t } = useI18n()
const dialog = ref<HTMLDialogElement | null>(null)

/** 关闭当前弹窗或抽屉 */
function close() {
    dialog.value?.close()
}

/** 点击遮罩层时关闭登录弹窗 */
function closeFromBackdrop(event: MouseEvent) {
    if (event.target === dialog.value) {
        close()
    }
}

/** 同步原生对话框的打开状态 */
async function syncDialog(open: boolean) {
    await nextTick()
    if (open && !dialog.value?.open) {
        dialog.value?.showModal()
    } else if (!open && dialog.value?.open) {
        dialog.value.close()
    }
}

watch(() => props.modelValue, syncDialog)
onMounted(() => syncDialog(props.modelValue))
</script>

<template>
    <dialog
        ref="dialog"
        class="m-auto w-[calc(100%_-_2rem)] max-w-md overflow-visible rounded-3xl bg-transparent p-0 text-left shadow-2xl"
        :aria-label="t('auth.loginTitle')"
        @cancel.prevent="close"
        @close="emit('update:modelValue', false)"
        @click="closeFromBackdrop"
    >
        <div class="relative rounded-3xl border border-line bg-surface p-6 sm:p-8">
            <button
                class="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full text-muted transition hover:bg-surface-muted hover:text-ink focus:outline-none focus:ring-4 focus:ring-brand/10"
                type="button"
                :aria-label="t('common.close')"
                @click="close"
            >
                <AppIcon name="close" />
            </button>

            <LoginForm :redirect-path="redirectPath" />
        </div>
    </dialog>
</template>

<style scoped>
dialog::backdrop {
    background: rgba(15, 23, 42, 0.58);
    backdrop-filter: blur(8px);
}
</style>
