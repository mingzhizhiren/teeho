<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { cleanupAnalysisUserAssets } from '@/api/analysis'
import AppConfirmDialog from '@/components/AppConfirmDialog.vue'
import InlineFeedback from '@/components/feedback/InlineFeedback.vue'
import { useUserStorage } from '@/composables/useUserStorage'
import { useAuthStore } from '@/stores/auth'
import { createAccountSessionFlow } from './account.session'

const emit = defineEmits<{
    suspend: []
}>()

const auth = useAuthStore()
const userStorage = useUserStorage()
const router = useRouter()
const { t } = useI18n()
const isClearing = ref(false)
const clearOnlyConfirmOpen = ref(false)
const clearAndLogoutConfirmOpen = ref(false)
const errorMessage = ref('')
const sessionFlow = createAccountSessionFlow({
    logout: (options) => auth.logout(options),
    clearCurrentUserData: () => userStorage.clearAll(),
    async cleanupCurrentUserAssets() {
        await cleanupAnalysisUserAssets()
    },
    navigateHome: () => router.replace('/'),
    refreshWorkspace: async () => router.go(0),
    beforeLogout: () => emit('suspend'),
    beforeWorkspaceReset: () => emit('suspend'),
})

async function clearLocalData(): Promise<void> {
    if (isClearing.value) {
        clearOnlyConfirmOpen.value = false
        return
    }
    clearOnlyConfirmOpen.value = false
    isClearing.value = true
    errorMessage.value = ''
    try {
        const result = await sessionFlow.clearCurrentUserDataWithoutSignOut()
        if (result.kind === 'local_data_failed') {
            errorMessage.value = t('auth.clearLocalDataFailed')
        }
    } finally {
        isClearing.value = false
    }
}

async function clearLocalDataAndSignOut(): Promise<void> {
    if (isClearing.value) {
        clearAndLogoutConfirmOpen.value = false
        return
    }
    clearAndLogoutConfirmOpen.value = false
    isClearing.value = true
    errorMessage.value = ''
    try {
        const result = await sessionFlow.clearCurrentUserDataAndSignOut()
        if (result.kind === 'local_data_failed') {
            errorMessage.value = t('auth.clearLocalDataFailed')
        } else if (result.kind === 'logout_failed') {
            errorMessage.value = t('auth.logoutFailed')
        }
    } finally {
        isClearing.value = false
    }
}
</script>

<template>
    <section data-testid="account-actions">
        <p class="text-sm leading-6 text-muted">
            {{ t('account.sections.data.description') }}
        </p>

        <div class="mt-5 rounded-2xl border border-red-200 bg-red-50/60 p-4 dark:border-red-400/20 dark:bg-red-400/5">
            <h4 class="font-semibold text-red-700 dark:text-red-200">
                {{ t('account.localDataTitle') }}
            </h4>
            <p class="mt-1 text-xs leading-5 text-red-700/80 dark:text-red-200/75">
                {{ t('account.localDataDescription') }}
            </p>
            <div class="mt-4 grid gap-2 sm:grid-cols-2">
                <button
                    class="min-h-11 rounded-xl border border-red-200 bg-surface px-4 py-2.5 text-sm font-semibold text-red-600 transition hover:border-red-300 hover:bg-red-50 disabled:opacity-60 dark:border-red-400/30 dark:text-red-300 dark:hover:bg-red-400/10"
                    type="button"
                    :disabled="isClearing"
                    @click="clearOnlyConfirmOpen = true"
                >
                    {{ isClearing ? t('auth.clearingLocalData') : t('auth.clearLocalData') }}
                </button>
                <button
                    class="min-h-11 rounded-xl border border-red-200 bg-surface px-4 py-2.5 text-sm font-semibold text-red-600 transition hover:border-red-300 hover:bg-red-50 disabled:opacity-60 dark:border-red-400/30 dark:text-red-300 dark:hover:bg-red-400/10"
                    type="button"
                    :disabled="isClearing"
                    @click="clearAndLogoutConfirmOpen = true"
                >
                    {{
                        isClearing
                            ? t('auth.clearingLocalData')
                            : t('auth.clearLocalDataAndLogout')
                    }}
                </button>
            </div>
        </div>

        <InlineFeedback
            v-if="errorMessage"
            class="mt-4"
            compact
            :feedback="{
                key: 'account.local-data.clear',
                scope: 'module',
                tone: 'error',
                message: errorMessage,
                announce: 'assertive',
            }"
        />
    </section>

    <AppConfirmDialog
        v-model:open="clearOnlyConfirmOpen"
        :title="t('auth.clearLocalDataOnlyConfirmTitle')"
        :description="t('auth.clearLocalDataOnlyConfirm')"
        :confirm-label="t('auth.clearLocalDataOnlyConfirmAction')"
        :cancel-label="t('common.cancel')"
        :busy="isClearing"
        tone="danger"
        @confirm="clearLocalData"
    />

    <AppConfirmDialog
        v-model:open="clearAndLogoutConfirmOpen"
        :title="t('auth.clearLocalDataConfirmTitle')"
        :description="t('auth.clearLocalDataConfirm')"
        :confirm-label="t('auth.clearLocalDataConfirmAction')"
        :cancel-label="t('common.cancel')"
        :busy="isClearing"
        tone="danger"
        @confirm="clearLocalDataAndSignOut"
    />
</template>
