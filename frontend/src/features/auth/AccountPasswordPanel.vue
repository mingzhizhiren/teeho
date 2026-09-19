<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import InlineFeedback from '@/components/feedback/InlineFeedback.vue'
import { useAuthStore } from '@/stores/auth'
import { resolvePasswordChangeFeedback } from './password-change.feedback'

const emit = defineEmits<{
    suspend: []
}>()

const auth = useAuthStore()
const router = useRouter()
const { t } = useI18n()
const isChanging = ref(false)
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const currentError = ref('')
const newError = ref('')
const confirmError = ref('')
const formError = ref('')

function clearErrors(): void {
    currentError.value = ''
    newError.value = ''
    confirmError.value = ''
    formError.value = ''
}

async function submitPasswordChange(): Promise<void> {
    if (isChanging.value || !auth.user?.canChangePassword) return
    clearErrors()
    if (newPassword.value !== confirmPassword.value) {
        confirmError.value = t('auth.passwordMismatch')
        return
    }
    isChanging.value = true
    try {
        const outcome = await auth.changePassword({
            currentPassword: currentPassword.value,
            newPassword: newPassword.value,
            confirmPassword: confirmPassword.value,
        })
        emit('suspend')
        const passwordChange =
            outcome.reason === 'result_unknown'
                ? 'unknown'
                : outcome.reason === 'changed'
                  ? 'changed'
                  : undefined
        await router.replace({
            path: '/login',
            query: passwordChange ? { password_change: passwordChange } : undefined,
        })
    } catch (error) {
        const feedback = resolvePasswordChangeFeedback(error, t('auth.changePasswordFailed'))
        if (feedback.field === 'current') currentError.value = feedback.message
        else if (feedback.field === 'new') newError.value = feedback.message
        else formError.value = feedback.message
    } finally {
        isChanging.value = false
    }
}
</script>

<template>
    <section data-testid="account-password-section">
        <p class="text-sm leading-6 text-muted">
            {{ t('account.sections.security.description') }}
        </p>
        <form class="mt-5 grid gap-4" @submit.prevent="submitPasswordChange">
            <label class="grid gap-1.5 text-sm font-medium text-ink">
                <span>{{ t('auth.currentPassword') }}</span>
                <input
                    id="account-current-password"
                    v-model="currentPassword"
                    class="min-h-12 rounded-xl border border-line bg-surface px-3 text-ink outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
                    type="password"
                    autocomplete="current-password"
                    minlength="8"
                    maxlength="128"
                    required
                    :aria-invalid="Boolean(currentError)"
                    :aria-describedby="currentError ? 'account-current-password-error' : undefined"
                    :disabled="isChanging"
                    @input="currentError = ''"
                />
                <InlineFeedback
                    v-if="currentError"
                    element-id="account-current-password-error"
                    compact
                    :feedback="{ key: 'account.password.current', scope: 'field', tone: 'error', message: currentError, announce: 'assertive' }"
                />
            </label>
            <label class="grid gap-1.5 text-sm font-medium text-ink">
                <span>{{ t('auth.newPassword') }}</span>
                <input
                    id="account-new-password"
                    v-model="newPassword"
                    class="min-h-12 rounded-xl border border-line bg-surface px-3 text-ink outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
                    type="password"
                    autocomplete="new-password"
                    minlength="8"
                    maxlength="128"
                    required
                    :aria-invalid="Boolean(newError)"
                    :aria-describedby="newError ? 'account-new-password-error' : undefined"
                    :disabled="isChanging"
                    @input="newError = ''"
                />
                <InlineFeedback
                    v-if="newError"
                    element-id="account-new-password-error"
                    compact
                    :feedback="{ key: 'account.password.new', scope: 'field', tone: 'error', message: newError, announce: 'assertive' }"
                />
            </label>
            <label class="grid gap-1.5 text-sm font-medium text-ink">
                <span>{{ t('auth.confirmNewPassword') }}</span>
                <input
                    id="account-confirm-password"
                    v-model="confirmPassword"
                    class="min-h-12 rounded-xl border border-line bg-surface px-3 text-ink outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
                    type="password"
                    autocomplete="new-password"
                    minlength="8"
                    maxlength="128"
                    required
                    :aria-invalid="Boolean(confirmError)"
                    :aria-describedby="confirmError ? 'account-confirm-password-error' : undefined"
                    :disabled="isChanging"
                    @input="confirmError = ''"
                />
                <InlineFeedback
                    v-if="confirmError"
                    element-id="account-confirm-password-error"
                    compact
                    :feedback="{ key: 'account.password.confirm', scope: 'field', tone: 'error', message: confirmError, announce: 'assertive' }"
                />
            </label>
            <InlineFeedback
                v-if="formError"
                compact
                :feedback="{
                    key: 'account.password.change',
                    scope: 'form',
                    tone: 'error',
                    message: formError,
                    announce: 'assertive',
                }"
            />
            <button
                class="min-h-11 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
                type="submit"
                :disabled="isChanging"
            >
                {{ isChanging ? t('auth.changingPassword') : t('auth.changePasswordAction') }}
            </button>
        </form>
    </section>
</template>
