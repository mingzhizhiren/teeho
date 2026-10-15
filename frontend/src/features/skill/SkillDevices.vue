<script setup lang="ts">
import AppButton from '@/components/AppButton.vue'
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { listSkillDevices, revokeSkillDevice, type SkillDevice } from '@/api/skill'
const { t } = useI18n()
const devices = ref<SkillDevice[]>([])
const pending = ref(false)
const failed = ref(false)
const nextCursor = ref<string | null>(null)
const controller = new AbortController()
async function load(more = false): Promise<void> {
    if (pending.value) return
    pending.value = true
    failed.value = false
    try {
        const page = await listSkillDevices(
            more ? (nextCursor.value ?? undefined) : undefined,
            controller.signal,
        )
        if (controller.signal.aborted) return
        devices.value = more ? [...devices.value, ...page.devices] : page.devices
        nextCursor.value = page.nextCursor
    } catch {
        if (!controller.signal.aborted) failed.value = true
    } finally {
        pending.value = false
    }
}
async function revoke(id: string): Promise<void> {
    if (pending.value) return
    pending.value = true
    failed.value = false
    try {
        await revokeSkillDevice(id, controller.signal)
        if (controller.signal.aborted) return
        devices.value = devices.value.filter((device) => device.id !== id)
    } catch {
        if (!controller.signal.aborted) failed.value = true
    } finally {
        pending.value = false
    }
}
onMounted(() => load())
onBeforeUnmount(() => controller.abort())
</script>
<template>
    <h2 class="text-2xl font-semibold text-ink">{{ t('skillAuth.devices') }}</h2>
    <p class="mt-3 text-sm leading-6 text-muted">{{ t('skillAuth.deviceLimit') }}</p>
    <p v-if="failed" role="alert" class="mt-4 text-ink">{{ t('skillAuth.devicesError') }}</p>
    <AppButton variant="secondary" size="md" :disabled="pending" class="mt-4" @click="load()">
        {{ t('skillAuth.refresh') }}
    </AppButton>
    <p v-if="pending" role="status" class="mt-4 text-muted">{{ t('skillAuth.loading') }}</p>
    <p v-if="!pending && !failed && !devices.length" class="mt-4 text-muted">
        {{ t('skillAuth.empty') }}
    </p>
    <ul class="mt-6 space-y-4">
        <li
            v-for="device in devices"
            :key="device.id"
            class="ui-device-card rounded-xl border border-line p-4"
        >
            <p class="break-words text-ink">{{ device.name }}</p>
            <p class="text-sm text-muted">
                {{
                    device.expiresAt
                        ? new Date(device.expiresAt).toLocaleString()
                        : t('skillAuth.longTerm')
                }}
            </p>
            <AppButton
                variant="danger"
                size="sm"
                icon="trash"
                :disabled="pending"
                class="mt-3"
                @click="revoke(device.id)"
            >
                {{ t('skillAuth.revoke') }}
            </AppButton>
        </li>
    </ul>
    <AppButton
        v-if="nextCursor"
        variant="secondary"
        size="md"
        :disabled="pending"
        class="mt-4"
        @click="load(true)"
    >
        {{ t('skillAuth.loadMore') }}
    </AppButton>
</template>
