<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import InlineFeedback from '@/components/feedback/InlineFeedback.vue'
import type { UiFeedback } from '@/components/feedback/feedback'
import AppSpinner from '@/components/icons/AppSpinner.vue'
import { authInputConstraints } from '@/features/auth/auth.constants'
import { useAuthStore } from '@/stores/auth'
import { getFrontendRuntime } from '@/edition/runtime'
import { getApiRequestErrorMessage } from '@/utils/apiRequestError'
import { resolveSafeRedirect } from '@/utils/redirect'

const runtime = getFrontendRuntime()
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const agreementAccepted = ref(!runtime.registrationAgreement)
const form = ref<HTMLFormElement | null>(null)
const confirmPasswordInput = ref<HTMLInputElement | null>(null)
const submitting = ref(false)
const completed = ref(false)
const passwordMismatch = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')
const redirectPath = computed(() => resolveSafeRedirect(route.query.redirect))
const displayError = computed(
    () => errorMessage.value || (route.query.oauth_error === '1' ? t('auth.oauthFailed') : ''),
)
const errorFeedback = computed<UiFeedback | null>(() =>
    displayError.value
        ? {
              key: 'auth.register.submit',
              scope: 'form',
              tone: 'error',
              message: displayError.value,
              announce: 'assertive',
          }
        : null,
)
const noticeFeedback = computed<UiFeedback | null>(() =>
    noticeMessage.value
        ? {
              key: 'auth.register.confirmation',
              scope: 'form',
              tone: 'info',
              message: noticeMessage.value,
              announce: 'polite',
          }
        : null,
)
const passwordMismatchFeedback = computed<UiFeedback | null>(() =>
    passwordMismatch.value
        ? {
              key: 'auth.register.confirm-password',
              scope: 'field',
              tone: 'error',
              message: t('auth.passwordMismatch'),
              announce: 'assertive',
          }
        : null,
)

watch(
    () => [password.value, confirmPassword.value] as const,
    ([nextPassword, nextConfirmation]) => {
        if (passwordMismatch.value && nextPassword === nextConfirmation) {
            passwordMismatch.value = false
        }
    },
)

/** 校验并提交当前表单 */
async function submit() {
    if (
        submitting.value ||
        completed.value ||
        !agreementAccepted.value ||
        !form.value?.reportValidity()
    ) {
        return
    }

    errorMessage.value = ''
    noticeMessage.value = ''
    passwordMismatch.value = false
    if (password.value !== confirmPassword.value) {
        passwordMismatch.value = true
        confirmPasswordInput.value?.focus()
        return
    }

    submitting.value = true
    try {
        const result = await auth.register(email.value, password.value)
        if (result.requiresEmailConfirmation) {
            completed.value = true
            noticeMessage.value = t('auth.registrationConfirmation')
            return
        }

        await router.replace(redirectPath.value)
    } catch (error) {
        errorMessage.value = getApiRequestErrorMessage(error, t('auth.registrationFailed'))
    } finally {
        submitting.value = false
    }
}
</script>

<template>
    <div>
        <p class="text-sm font-medium text-brand">{{ t('auth.registerEyebrow') }}</p>
        <h2 class="mt-2 text-3xl font-semibold tracking-[-0.03em] text-ink">
            {{ t('auth.registerTitle') }}
        </h2>
        <p class="mt-3 text-sm leading-6 text-muted">
            {{ t('auth.registerDescription') }}
        </p>
    </div>

    <!--<GoogleAuthButton class="mt-8" :next="redirectPath" :disabled="!agreementAccepted" />-->

    <div class="my-6 flex items-center gap-3 text-xs text-muted">
        <span class="h-px flex-1 bg-line"></span>
        <span>{{ t('auth.or') }}</span>
        <span class="h-px flex-1 bg-line"></span>
    </div>

    <form ref="form" class="space-y-5" @submit.prevent="submit">
        <div>
            <label for="email" class="mb-2 block text-sm font-medium text-ink">
                {{ t('auth.email') }}
            </label>
            <input
                id="email"
                v-model.trim="email"
                class="h-12 w-full rounded-xl border border-line bg-surface px-4 text-sm text-ink outline-none transition placeholder:text-muted/60 focus:border-brand focus:ring-4 focus:ring-brand/10 disabled:bg-surface-muted"
                type="email"
                name="email"
                autocomplete="email"
                :placeholder="t('auth.emailPlaceholder')"
                :maxlength="authInputConstraints.emailMaxLength"
                required
                autofocus
                :disabled="completed"
            />
        </div>

        <div>
            <label for="password" class="mb-2 block text-sm font-medium text-ink">
                {{ t('auth.password') }}
            </label>
            <input
                id="password"
                v-model="password"
                class="h-12 w-full rounded-xl border border-line bg-surface px-4 text-sm text-ink outline-none transition placeholder:text-muted/60 focus:border-brand focus:ring-4 focus:ring-brand/10 disabled:bg-surface-muted"
                type="password"
                name="password"
                autocomplete="new-password"
                :placeholder="t('auth.passwordPlaceholder')"
                :minlength="authInputConstraints.passwordMinLength"
                :maxlength="authInputConstraints.passwordMaxLength"
                required
                :disabled="completed"
                :aria-invalid="passwordMismatch"
                :aria-describedby="
                    passwordMismatch ? 'register-confirm-password-feedback' : undefined
                "
            />
            <InlineFeedback
                v-if="passwordMismatchFeedback"
                class="mt-2"
                compact
                element-id="register-confirm-password-feedback"
                :feedback="passwordMismatchFeedback"
            />
        </div>

        <div>
            <label for="confirm-password" class="mb-2 block text-sm font-medium text-ink">
                {{ t('auth.confirmPassword') }}
            </label>
            <input
                id="confirm-password"
                ref="confirmPasswordInput"
                v-model="confirmPassword"
                class="h-12 w-full rounded-xl border border-line bg-surface px-4 text-sm text-ink outline-none transition placeholder:text-muted/60 focus:border-brand focus:ring-4 focus:ring-brand/10 disabled:bg-surface-muted"
                type="password"
                name="confirm-password"
                autocomplete="new-password"
                :placeholder="t('auth.confirmPasswordPlaceholder')"
                :minlength="authInputConstraints.passwordMinLength"
                :maxlength="authInputConstraints.passwordMaxLength"
                required
                :disabled="completed"
            />
        </div>

        <component
            :is="runtime.registrationAgreement"
            v-if="runtime.registrationAgreement"
            v-model="agreementAccepted"
            :disabled="completed"
        />

        <InlineFeedback
            v-if="errorFeedback"
            element-id="register-form-feedback"
            :feedback="errorFeedback"
        />

        <InlineFeedback v-if="noticeFeedback" :feedback="noticeFeedback" />

        <button
            class="flex h-12 w-full items-center justify-center rounded-xl bg-ink px-4 text-sm font-semibold text-surface transition hover:opacity-90 focus:outline-none focus:ring-4 focus:ring-brand/15 disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
            :disabled="submitting || completed || !agreementAccepted"
        >
            <AppSpinner v-if="submitting" class="mr-2" />
            {{ submitting ? t('auth.registering') : t('auth.register') }}
        </button>
    </form>

    <p class="mt-7 text-center text-sm text-muted">
        {{ t('auth.alreadyHaveAccount') }}
        <RouterLink
            class="font-semibold text-brand transition hover:text-brand-hover"
            :to="{ path: '/login', query: { redirect: redirectPath } }"
        >
            {{ t('auth.goToLogin') }}
        </RouterLink>
    </p>
</template>
