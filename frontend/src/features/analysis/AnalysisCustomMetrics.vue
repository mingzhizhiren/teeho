<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { CustomMetric } from './analysis.custom-metrics'

interface Props {
    metrics: readonly CustomMetric[]
}
defineProps<Props>()
const { t } = useI18n()
</script>

<template>
    <dl
        v-if="metrics.length"
        class="space-y-4 rounded-3xl border border-line bg-surface p-5 sm:p-6"
        data-testid="analysis-custom-metrics"
    >
        <div v-for="item in metrics" :key="item.id" class="min-w-0 break-words">
            <dt class="font-semibold text-ink">{{ item.name }}</dt>
            <dd class="mt-1 text-ink">
                <template v-if="item.status === 'available'">
                    {{ item.value }} {{ item.unit }}
                </template>
                <template v-else>{{ t('skillAuth.metricUnavailable') }}</template>
            </dd>
            <dd v-if="item.description" class="mt-1 whitespace-pre-wrap text-sm text-muted">
                {{ item.description }}
            </dd>
        </div>
    </dl>
</template>
