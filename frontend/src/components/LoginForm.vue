<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import InlineFeedback from '@/components/feedback/InlineFeedback.vue'
import type { UiFeedback } from '@/components/feedback/feedback'
import AppIcon from '@/components/icons/AppIcon.vue'
import AppSpinner from '@/components/icons/AppSpinner.vue'
import { authInputConstraints } from '@/features/auth/auth.constants'
import { useAuthStore } from '@/stores/auth'
import { getApiRequestErrorMessage } from '@/utils/apiRequestError'

const props = withDefaults(
    defineProps<{ redirectPath?: string; showRegistration?: boolean }>(),
    {
        redirectPath: '/workspace',
        showRegistration: true,
    },
)

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const email = ref('')
const password = ref('')
const form = ref<HTMLFormElement | null>(null)
const showPassword = ref(false)
const submitting = ref(false)
const errorMessage = ref('')
const errorFeedback = computed<UiFeedback | null>(() => {
    if (errorMessage.value || route.query.oauth_error === '1') {
        return {
            key: 'auth.login.submit',
            scope: 'form',
            tone: 'error',
            message: errorMessage.value || t('auth.oauthFailed'),
            announce: 'assertive',
        }
    }
    if (route.query.password_change === 'unknown') {
        return {
            key: 'auth.password.change.unknown',
            scope: 'form',
            tone: 'warning',
            message: t('auth.passwordChangeResultUnknown'),
            announce: 'assertive',
        }
    }
    if (route.query.password_change === 'changed') {
        return {
            key: 'auth.password.change.complete',
            scope: 'form',
            tone: 'success',
            message: t('auth.passwordChanged'),
            announce: 'polite',
        }
    }
    return null
})

/** 校验并提交当前表单 */
async function submit() {
    if (submitting.value || !form.value?.reportValidity()) {
        return
    }

    submitting.value = true
    errorMessage.value = ''

    try {
        await auth.login(email.value, password.value)
        await router.replace(props.redirectPath)
    } catch (error) {
        errorMessage.value = getApiRequestErrorMessage(error, t('auth.loginFailed'))
    } finally {
        submitting.value = false
    }
}
</script>

<template>
    <div>
        <div>
            <p class="text-sm font-medium text-brand">{{ t('auth.welcomeBack') }}</p>
            <h2 class="mt-2 text-3xl font-semibold tracking-[-0.03em] text-ink">
                {{ t('auth.loginTitle') }}
            </h2>
            <p class="mt-3 text-sm leading-6 text-muted">
                {{ t('auth.loginDescription') }}
            </p>
        </div>

        <!--<GoogleAuthButton class="mt-8" :next="redirectPath" />-->

        <div class="my-6 flex items-center gap-3 text-xs text-muted">
            <span class="h-px flex-1 bg-line"></span>
            <span>{{ t('auth.or') }}</span>
            <span class="h-px flex-1 bg-line"></span>
        </div>

        <form ref="form" class="space-y-5" @submit.prevent="submit">
            <div>
                <label for="login-email" class="mb-2 block text-sm font-medium text-ink">
                    {{ t('auth.email') }}
                </label>
                <input
                    id="login-email"
                    v-model.trim="email"
                    class="h-12 w-full rounded-xl border border-line bg-surface px-4 text-sm text-ink outline-none transition placeholder:text-muted/60 focus:border-brand focus:ring-4 focus:ring-brand/10"
                    type="email"
                    name="email"
                    autocomplete="email"
                    :placeholder="t('auth.emailPlaceholder')"
                    :maxlength="authInputConstraints.emailMaxLength"
                    required
                    autofocus
                />
            </div>

            <div>
                <label for="login-password" class="mb-2 block text-sm font-medium text-ink">
                    {{ t('auth.password') }}
                </label>
                <div class="relative">
                    <input
                        id="login-password"
                        v-model="password"
                        class="h-12 w-full rounded-xl border border-line bg-surface px-4 pr-16 text-sm text-ink outline-none transition placeholder:text-muted/60 focus:border-brand focus:ring-4 focus:ring-brand/10"
                        :type="showPassword ? 'text' : 'password'"
                        name="password"
                        autocomplete="current-password"
                        :placeholder="t('auth.passwordPlaceholder')"
                        :minlength="authInputConstraints.passwordMinLength"
                        :maxlength="authInputConstraints.passwordMaxLength"
                        required
                    />
                    <button
                        class="absolute inset-y-0 right-1 my-auto flex h-11 w-11 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                        type="button"
                        :aria-label="showPassword ? t('auth.hidePassword') : t('auth.showPassword')"
                        :title="showPassword ? t('auth.hidePassword') : t('auth.showPassword')"
                        @click="showPassword = !showPassword"
                    >
                        <AppIcon
                            :data-password-visible="showPassword"
                            :name="showPassword ? 'eye' : 'eye-off'"
                        />
                    </button>
                </div>
            </div>

            <InlineFeedback
                v-if="errorFeedback"
                element-id="login-form-feedback"
                :feedback="errorFeedback"
            />

            <button
                class="flex h-12 w-full items-center justify-center rounded-xl bg-ink px-4 text-sm font-semibold text-surface transition hover:opacity-90 focus:outline-none focus:ring-4 focus:ring-brand/15 disabled:cursor-not-allowed disabled:opacity-60"
                type="submit"
                :disabled="submitting"
            >
                <AppSpinner
                    v-if="submitting"
                    class="mr-2"
                />
                {{ submitting ? t('auth.loggingIn') : t('auth.login') }}
            </button>
        </form>

        <p v-if="showRegistration" class="mt-7 text-center text-sm text-muted">
            {{ t('auth.noAccount') }}
            <RouterLink
                class="font-semibold text-brand transition hover:text-brand-hover"
                :to="{ path: '/register', query: { redirect: redirectPath } }"
            >
                {{ t('auth.createAccount') }}
            </RouterLink>
        </p>
    </div>
</template>
