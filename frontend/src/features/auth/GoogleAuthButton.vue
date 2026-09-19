<template>
    <a
        class="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink transition focus:outline-none focus:ring-4 focus:ring-brand/10"
        :class="
            disabled
                ? 'cursor-not-allowed opacity-60'
                : 'hover:border-muted/60 hover:bg-surface-muted'
        "
        :href="disabled ? undefined : oauthUrl"
        :aria-disabled="disabled"
        :tabindex="disabled ? -1 : undefined"
    >
        <svg class="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
            <path
                fill="#4285F4"
                d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.91h5.38a4.6 4.6 0 01-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.4z"
            />
            <path
                fill="#34A853"
                d="M12 22c2.7 0 4.98-.9 6.63-2.37l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0012 22z"
            />
            <path
                fill="#FBBC05"
                d="M6.39 13.92A6 6 0 016.08 12c0-.67.11-1.32.31-1.92V7.46H3.04A10 10 0 002 12c0 1.61.39 3.14 1.04 4.54l3.35-2.62z"
            />
            <path
                fill="#EA4335"
                d="M12 5.95c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.63 9.63 0 0012 2a10 10 0 00-8.96 5.46l3.35 2.62C7.18 7.71 9.39 5.95 12 5.95z"
            />
        </svg>
        {{ t('auth.continueWithGoogle') }}
    </a>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { getGoogleOAuthUrl } from '@/api/auth'

const props = withDefaults(defineProps<{ next?: string; disabled?: boolean }>(), {
    next: '/workspace',
    disabled: false,
})
const { t } = useI18n()
const oauthUrl = computed(() => getGoogleOAuthUrl(props.next))
</script>
