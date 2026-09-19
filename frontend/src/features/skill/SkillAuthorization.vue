<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { approveSkillDevice } from '@/api/skill'
import { ApiRequestError } from '@/utils/apiRequestError'
import { HTTP_STATUS } from '@/config/constants'
const { t } = useI18n()
const userCode = ref('')
const remember = ref(true)
const isPending = ref(false)
const isApproved = ref(false)
const error = ref<'unknown' | 'rejected' | null>(null)
const expiresAt = ref<string | null>(null)
const controller = new AbortController()
onBeforeUnmount(() => controller.abort())
async function approve(): Promise<void> {
    if (isPending.value) return
    isPending.value = true
    error.value = null
    try {
        const result = await approveSkillDevice(
            userCode.value.trim().toUpperCase(),
            remember.value,
            controller.signal,
        )
        if (controller.signal.aborted) return
        expiresAt.value = result.expiresAt
        isApproved.value = true
    } catch (cause) {
        if (controller.signal.aborted) return
        const rejected =
            cause instanceof ApiRequestError &&
            [HTTP_STATUS.BAD_REQUEST, HTTP_STATUS.UNAUTHORIZED, HTTP_STATUS.FORBIDDEN].some(
                (status) => status === cause.status,
            )
        error.value = rejected ? 'rejected' : 'unknown'
    } finally {
        isPending.value = false
    }
}
</script>
<template>
    <section>
        <h2 class="text-2xl font-semibold text-ink">{{ t('skillAuth.title') }}</h2>
        <p class="mt-3 text-sm text-muted">{{ t('skillAuth.explanation') }}</p>
        <div v-if="isApproved" class="mt-6 text-ink" role="status">
            <p>{{ t('skillAuth.success') }}</p>
            <p v-if="expiresAt">
                {{ t('skillAuth.expires') }} {{ new Date(expiresAt).toLocaleString() }}
            </p>
        </div>
        <form v-else class="mt-6 space-y-5" @submit.prevent="approve">
            <label class="block text-ink">
                {{ t('skillAuth.code') }}
                <input
                    v-model="userCode"
                    :disabled="isPending || error === 'unknown'"
                    required
                    pattern="\s*[a-fA-F0-9]{10}\s*"
                    :title="t('skillAuth.codeFormat')"
                    autocomplete="off"
                    class="mt-2 w-full rounded-xl border border-line bg-surface p-3 uppercase text-ink"
                />
            </label>
            <label class="flex items-center gap-3 text-sm text-ink">
                <input
                    v-model="remember"
                    type="checkbox"
                    :disabled="isPending || error === 'unknown'"
                />
                {{ t('skillAuth.remember') }}
            </label>
            <p v-if="!remember" class="text-sm text-muted">{{ t('skillAuth.temporary') }}</p>
            <p v-if="error" role="alert" class="text-sm text-red-700 dark:text-red-200">
                {{ t(error === 'unknown' ? 'skillAuth.unknown' : 'skillAuth.error') }}
            </p>
            <button
                :disabled="isPending"
                type="submit"
                class="w-full rounded-xl bg-brand p-3 font-semibold text-on-brand disabled:opacity-50"
            >
                {{
                    isPending
                        ? t('skillAuth.pending')
                        : t(error === 'unknown' ? 'skillAuth.retry' : 'skillAuth.approve')
                }}
            </button>
        </form>
    </section>
</template>
