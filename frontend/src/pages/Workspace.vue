<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import BrandMark from '@/components/BrandMark.vue'
import AnalysisWorkspace from '@/features/analysis/AnalysisWorkspace.vue'
import WorkspaceAccountControls from '@/features/auth/WorkspaceAccountControls.vue'
import BusinessNotificationCenter from '@/features/notifications/BusinessNotificationCenter.vue'
import { getFrontendRuntime } from '@/edition/runtime'
import { createBrowserWorkspaceEventStream } from '@/features/workspace-events/workspace-event.adapter'
import { useAuthStore } from '@/stores/auth'
import { useWorkspaceEventsStore } from '@/stores/workspaceEvents'

const runtime = getFrontendRuntime()
const auth = useAuthStore()
const workspaceEvents = useWorkspaceEventsStore()
const { t } = useI18n()
const eventStream = createBrowserWorkspaceEventStream({
    onEvent: workspaceEvents.receive,
    onCompensate: workspaceEvents.compensate,
})

onMounted(() => {
    workspaceEvents.reset(auth.user?.id ?? null)
    eventStream.start()
})

onBeforeUnmount(() => {
    eventStream.stop()
})
</script>

<template>
    <div class="min-h-screen bg-canvas">
        <header class="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
            <div
                class="mx-auto flex h-16 max-w-screen-2xl items-center justify-between gap-1 px-4 sm:gap-3 sm:px-8"
            >
                <div class="flex items-center gap-3 sm:gap-6">
                    <RouterLink
                        to="/"
                        class="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                        :aria-label="t('common.home')"
                    >
                        <BrandMark compact />
                    </RouterLink>
                    <RouterLink
                        to="/skill"
                        class="hidden rounded-lg px-2 py-2 text-sm font-semibold text-muted transition hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand sm:block sm:px-3"
                    >
                        {{ t('skillInstall.workspaceNavLabel') }}
                    </RouterLink>
                </div>

                <div class="flex items-center gap-1 sm:gap-2">
                    <BusinessNotificationCenter />
                    <component :is="runtime.workspaceHeader" v-if="runtime.workspaceHeader" />
                    <WorkspaceAccountControls />
                </div>
            </div>
        </header>

        <main class="min-h-[calc(100vh-4rem)]">
            <AnalysisWorkspace />
        </main>
    </div>
</template>
