<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import InlineFeedback from '@/components/feedback/InlineFeedback.vue'
import { onboardingReplayChapterIds } from '@/features/onboarding/onboarding.catalog'
import { useOnboardingCoordinator } from '@/features/onboarding/onboarding.context'
import { isOnboardingChapterTargetAvailable } from '@/features/onboarding/onboarding.targets'
import type { OnboardingChapterId } from '@/features/onboarding/onboarding.types'

const emit = defineEmits<{
    suspend: []
    reopen: []
}>()

const { t } = useI18n()
const onboardingCoordinator = useOnboardingCoordinator()
const replayingChapter = ref<OnboardingChapterId | null>(null)
const replayError = ref('')

function canReplayChapter(chapterId: OnboardingChapterId): boolean {
    return (
        typeof document !== 'undefined' &&
        isOnboardingChapterTargetAvailable(document, chapterId)
    )
}

async function replayChapter(chapterId: OnboardingChapterId): Promise<void> {
    if (replayingChapter.value || !canReplayChapter(chapterId)) return
    replayingChapter.value = chapterId
    replayError.value = ''
    emit('suspend')
    await nextTick()
    const result = await onboardingCoordinator.replay(chapterId)
    replayingChapter.value = null
    if (result.status !== 'unavailable') return
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
            <li v-for="chapterId in onboardingReplayChapterIds" :key="chapterId">
                <button
                    class="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface-muted px-4 py-3 text-left text-sm transition hover:border-brand/40 disabled:cursor-not-allowed disabled:opacity-55"
                    type="button"
                    :data-onboarding-chapter="chapterId"
                    :disabled="!canReplayChapter(chapterId) || replayingChapter !== null"
                    @click="replayChapter(chapterId)"
                >
                    <span class="font-medium text-ink">
                        {{ t(`account.onboarding.chapters.${chapterId}`) }}
                    </span>
                    <span class="shrink-0 text-xs font-semibold text-brand">
                        {{
                            canReplayChapter(chapterId)
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
