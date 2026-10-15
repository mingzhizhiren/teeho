<script setup lang="ts">
import AppButton from '@/components/AppButton.vue'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import InlineFeedback from '@/components/feedback/InlineFeedback.vue'
import { useAuthStore } from '@/stores/auth'
import { signOutAccountSession } from './account.session'

const emit = defineEmits<{
    suspend: []
}>()

const auth = useAuthStore()
const router = useRouter()
const { t } = useI18n()
const isLoggingOut = ref(false)
const errorMessage = ref('')

async function signOut(): Promise<void> {
    if (isLoggingOut.value) return
    isLoggingOut.value = true
    errorMessage.value = ''
    try {
        const result = await signOutAccountSession({
            logout: (options) => auth.logout(options),
            navigateHome: () => router.replace('/'),
            beforeLogout: () => emit('suspend'),
        })
        if (result.kind === 'logout_failed') errorMessage.value = t('auth.logoutFailed')
    } finally {
        isLoggingOut.value = false
    }
}
</script>

<template>
    <div>
        <AppButton
            variant="secondary"
            size="md"
            class="w-full"
            type="button"
            :disabled="isLoggingOut"
            data-testid="account-sign-out"
            @click="signOut"
        >
            {{ isLoggingOut ? t('auth.loggingOut') : t('auth.logout') }}
        </AppButton>
        <InlineFeedback
            v-if="errorMessage"
            class="mt-2"
            compact
            :feedback="{
                key: 'account.session.logout',
                scope: 'module',
                tone: 'error',
                message: errorMessage,
                announce: 'assertive',
            }"
        />
    </div>
</template>
