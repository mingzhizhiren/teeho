<script setup lang="ts">
import { ref, watch } from 'vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import type { AppIconName } from '@/components/icons/appIcon'

const props = withDefaults(
    defineProps<{
        variant?: 'secondary' | 'primary' | 'danger'
        size?: 'sm' | 'md'
        type?: 'button' | 'submit' | 'reset'
        icon?: AppIconName
        iconOnly?: boolean
        disabled?: boolean
        loading?: boolean
        dangerSolid?: boolean
    }>(),
    {
        variant: 'secondary',
        size: 'md',
        type: 'button',
        icon: undefined,
        iconOnly: false,
        disabled: false,
        loading: false,
        dangerSolid: false,
    },
)
const element = ref<HTMLButtonElement | null>(null)
const loadingWidth = ref<number | null>(null)

// 在加载文字替换之前保留当前宽度，避免相邻按钮移动。
watch(
    () => props.loading,
    (loading) => {
        loadingWidth.value = loading ? (element.value?.getBoundingClientRect().width ?? null) : null
    },
)
</script>

<template>
    <button
        ref="element"
        :type="type"
        class="app-button"
        :class="[
            `app-button--${variant}`,
            `app-button--${size}`,
            {
                'app-button--icon-only': iconOnly,
                'app-button--danger-solid': variant === 'danger' && dangerSolid,
            },
        ]"
        :disabled="disabled || loading"
        :aria-busy="loading || undefined"
        :style="loadingWidth ? { minWidth: `${loadingWidth}px` } : undefined"
    >
        <span v-if="loading" class="app-button-spinner" aria-hidden="true"></span>
        <AppIcon v-else-if="icon" :name="icon" size="sm" />
        <slot />
    </button>
</template>
