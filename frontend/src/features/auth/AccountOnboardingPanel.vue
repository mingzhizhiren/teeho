<script setup lang="ts">
import { inject, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import InlineFeedback from '@/components/feedback/InlineFeedback.vue'
import { onboardingReplayChapterIds } from '@/features/onboarding/onboarding.catalog'
import { useOnboardingCoordinator } from '@/features/onboarding/onboarding.context'
import { isOnboardingChapterTargetAvailable } from '@/features/onboarding/onboarding.targets'
import type { OnboardingChapterId } from '@/features/onboarding/onboarding.types'
import {
    onboardingReplayEntriesKey,
    type OnboardingReplayEntry,
} from '@/features/onboarding/onboarding.replay-extension'

const emit = defineEmits<{
    suspend: []
    reopen: []
}>()

const { t } = useI18n()
const onboardingCoordinator = useOnboardingCoordinator()
const replayingChapter = ref<string | null>(null)
const replayError = ref('')
const chapters: readonly OnboardingReplayEntry[] = [
    ...onboardingReplayChapterIds.map((id) => ({
        id,
        titleKey: `account.onboarding.chapters.${id}`,
        available: () => canReplayChapter(id),
        replay: async (beforeStart: () => Promise<void>) => {
            await beforeStart()
            return (await onboardingCoordinator.replay(id)).status !== 'unavailable'
        },
    })),
    ...inject(onboardingReplayEntriesKey, []),
]

function canReplayChapter(chapterId: OnboardingChapterId): boolean {
    return (
        typeof document !== 'undefined' && isOnboardingChapterTargetAvailable(document, chapterId)
    )
}

async function replayChapter(chapter: OnboardingReplayEntry): Promise<void> {
    if (replayingChapter.value || !chapter.available()) return
    replayingChapter.value = chapter.id
    replayError.value = ''
    const started = await chapter.replay(async () => {
        emit('suspend')
        await nextTick()
    })
    replayingChapter.value = null
    if (started) return
    replayError.value = t('account.onboarding.replayUnavailable')
    emit('reopen')
}
</script>

<template>
    <section data-testid="onboarding-replay-list">
        <p class="text-sm leading-6 text-muted">
            {{ t('account.onboarding.description') }}
        </p>
        <ul class="mt-4 grid gap-2">
            <li v-for="chapter in chapters" :key="chapter.id">
                <button
                    class="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface-muted px-4 py-3 text-left text-sm transition hover:border-brand/40 disabled:cursor-not-allowed disabled:opacity-55"
                    type="button"
                    :data-onboarding-chapter="chapter.id"
                    :disabled="!chapter.available() || replayingChapter !== null"
                    @click="replayChapter(chapter)"
                >
                    <span class="font-medium text-ink">
                        {{ t(chapter.titleKey) }}
                    </span>
                    <span class="shrink-0 text-xs font-semibold text-brand">
                        {{
                            chapter.available()
                                ? t('account.onboarding.replay')
                                : t('account.onboarding.unavailable')
                        }}
                    </span>
                </button>
            </li>
        </ul>
        <InlineFeedback
            v-if="replayError"
            class="mt-3"
            compact
            :feedback="{
                key: 'account.onboarding.replay',
                scope: 'module',
                tone: 'error',
                message: replayError,
                announce: 'assertive',
            }"
        />
    </section>
</template>
