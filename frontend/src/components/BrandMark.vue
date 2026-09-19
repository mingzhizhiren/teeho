<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

withDefaults(
    defineProps<{
        compact?: boolean
        onDark?: boolean
    }>(),
    {
        compact: false,
        onDark: false,
    },
)

const { locale, t } = useI18n()
const isChinese = computed(() => locale.value === 'zh-CN')
</script>

<template>
    <div class="flex items-center gap-3">
        <img
            :class="compact ? 'h-8 w-auto' : 'h-10 w-auto'"
            :src="compact ? '/images/main/small_LOGO.png' : '/images/main/LOGO.png'"
            alt=""
            aria-hidden="true"
        />
        <span
            class="flex items-center overflow-hidden"
            :class="[
                compact ? 'h-8 w-24' : 'h-10 w-32',
                onDark ? 'rounded-lg bg-white/95 px-2 py-1 shadow-sm' : '',
            ]"
        >
            <img
                v-if="isChinese"
                class="h-full w-full object-contain object-left"
                :class="onDark ? '' : 'dark:invert'"
                src="/images/main/title.zh-CN.png"
                :alt="t('common.appName')"
            />
            <span
                v-else
                class="text-xl font-black italic tracking-[-0.04em]"
                :class="onDark ? 'text-slate-950' : 'text-ink'"
            >
                {{ t('common.appName') }}
            </span>
        </span>
    </div>
</template>
