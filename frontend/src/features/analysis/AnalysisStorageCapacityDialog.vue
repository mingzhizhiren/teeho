<template>
    <Teleport to="body">
        <div
            v-if="warning"
            class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            role="presentation"
            @click.self="emit('choose', 'cancel')"
        >
            <section
                class="w-full max-w-lg rounded-3xl border border-line bg-surface p-6 shadow-2xl sm:p-7"
                role="dialog"
                aria-modal="true"
                :aria-labelledby="titleId"
            >
                <h2 :id="titleId" class="text-lg font-semibold text-ink">
                    {{ t('workspace.storage.title') }}
                </h2>
                <p class="mt-3 text-sm leading-6 text-muted">
                    {{ t('workspace.storage.description') }}
                </p>
                <dl class="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div class="rounded-xl bg-surface-muted p-3">
                        <dt class="text-xs text-muted">
                            {{ t('workspace.storage.required') }}
                        </dt>
                        <dd class="mt-1 font-semibold text-ink">
                            {{ formatStorageSize(warning.requiredBytes) }}
                        </dd>
                    </div>
                    <div class="rounded-xl bg-surface-muted p-3">
                        <dt class="text-xs text-muted">
                            {{ t('workspace.storage.available') }}
                        </dt>
                        <dd class="mt-1 font-semibold text-ink">
                            {{ formatStorageSize(warning.availableBytes) }}
                        </dd>
                    </div>
                </dl>
                <p
                    class="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100"
                >
                    {{ t('workspace.storage.sessionOnlyWarning') }}
                </p>
                <div class="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
                    <AppButton
                        variant="secondary"
                        size="md"
                        type="button"
                        @click="emit('choose', 'cancel')"
                    >
                        {{ t('workspace.storage.cancel') }}
                    </AppButton>
                    <AppButton
                        variant="secondary"
                        size="md"
                        type="button"
                        @click="emit('choose', 'manage_history')"
                    >
                        {{ t('workspace.storage.manageHistory') }}
                    </AppButton>
                    <AppButton
                        variant="primary"
                        size="md"
                        type="button"
                        @click="emit('choose', 'session_only')"
                    >
                        {{ t('workspace.storage.sessionOnly') }}
                    </AppButton>
                </div>
            </section>
        </div>
    </Teleport>
</template>

<script setup lang="ts">
import AppButton from '@/components/AppButton.vue'
import { useI18n } from 'vue-i18n'

import { BYTE_SIZE } from '@/config/constants'
import { analysisUiConstraints } from './analysis.constants'
import type { InsufficientStorageChoice, StorageCapacity } from './storageCapacity'

defineProps<{
    warning: Extract<StorageCapacity, { status: 'insufficient' }> | null
}>()
const emit = defineEmits<{
    choose: [choice: InsufficientStorageChoice]
}>()
const { locale, t } = useI18n()
const titleId = 'analysis-storage-capacity-title'

/** 按当前语言格式化存储容量 */
function formatStorageSize(bytes: number) {
    const megabytes = bytes / BYTE_SIZE.MEBIBYTE
    return t('workspace.storage.megabytes', {
        value: new Intl.NumberFormat(locale.value, {
            maximumFractionDigits:
                megabytes >= analysisUiConstraints.megabyteIntegerDisplayThreshold ? 0 : 1,
        }).format(megabytes),
    })
}
</script>
