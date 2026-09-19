<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AuthPageLayout from '@/components/AuthPageLayout.vue'
import LoginForm from '@/components/LoginForm.vue'
import { resolveSafeRedirect } from '@/utils/redirect'

const route = useRoute()
const redirectPath = computed(() => resolveSafeRedirect(route.query.redirect))
</script>

<template>
    <AuthPageLayout>
        <LoginForm :redirect-path="redirectPath" />
    </AuthPageLayout>
</template>
