<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { RiskMatch } from './analysis.risk-matches'
defineProps<{ matches: readonly RiskMatch[]; reviewStatus?: 'completed' | 'unavailable' }>()
const { t } = useI18n()
</script>

<template>
    <div class="mt-5 border-t border-line pt-4" data-testid="analysis-term-risks">
        <h3 class="text-sm font-semibold text-ink">
            {{ t('workspace.checkup.contentAnalysis.risks') }}
        </h3>
        <p v-if="reviewStatus === 'unavailable'" class="mt-2 text-sm leading-6 text-muted">
            {{ t('workspace.checkup.contentAnalysis.riskReviewUnavailable') }}
        </p>
        <ul v-if="matches.length" class="mt-2 space-y-1.5">
            <li
                v-for="risk in matches"
                :key="`${risk.location}:${risk.term}:${risk.category}`"
                class="break-words text-sm leading-6"
            >
                <span class="font-semibold text-red-700 dark:text-red-300">{{ risk.term }}</span>
                <span class="text-muted">
                    — {{ t(`workspace.checkup.contentAnalysis.locations.${risk.location}`) }} ·
                    {{ risk.description }}</span
                >
            </li>
        </ul>
        <p v-else-if="reviewStatus !== 'unavailable'" class="mt-2 text-sm leading-6 text-muted">
            {{ t('workspace.checkup.contentAnalysis.noRisks') }}
        </p>
    </div>
</template>
