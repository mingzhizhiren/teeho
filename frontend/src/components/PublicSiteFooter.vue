<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
</script>

<template>
    <footer class="border-t border-line px-5 py-6 text-center text-sm text-muted">
        <a
            href="https://github.com/mingzhizhiren/teeho"
            class="font-semibold text-brand"
            target="_blank"
            rel="noopener noreferrer"
        >{{ t('community.source') }}</a
        >
        <p class="mt-2">{{ t('community.description') }}</p>
    </footer>
</template>
