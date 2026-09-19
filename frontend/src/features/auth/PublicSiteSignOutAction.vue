<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import InlineFeedback from '@/components/feedback/InlineFeedback.vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import { useAuthStore } from '@/stores/auth'
import { signOutAccountSession } from './account.session'

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
        })
        if (result.kind === 'logout_failed') errorMessage.value = t('auth.logoutFailed')
    } finally {
        isLoggingOut.value = false
    }
}
</script>

<template>
    <div class="relative inline-flex">
        <button
            class="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-ink shadow-sm transition hover:border-brand/40 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            :aria-label="t('auth.logout')"
            :title="t('auth.logout')"
            :disabled="isLoggingOut"
            data-testid="public-site-sign-out"
            @click="signOut"
        >
            <AppIcon name="logout" />
        </button>
        <InlineFeedback
            v-if="errorMessage"
            class="absolute right-0 top-full z-[80] mt-2 w-72 shadow-xl"
            compact
            :feedback="{
                key: 'public-site.session.logout',
                scope: 'module',
                tone: 'error',
                message: errorMessage,
                announce: 'assertive',
            }"
        />
    </div>
</template>
