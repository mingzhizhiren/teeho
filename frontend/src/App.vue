<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { getFrontendRuntime } from '@/edition/runtime'
import { computed, onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import {
    attachInteractionFeedbackBrowserEvents,
    createInteractionFeedbackCoordinator,
    interactionFeedbackCoordinatorKey,
} from '@/components/feedback/interactionFeedback'
import UnsupportedBrowserView from '@/components/feedback/UnsupportedBrowserView.vue'
import { useUserStorage } from '@/composables/useUserStorage'
import ProductGuideHost from '@/features/product-guide/ProductGuideHost.vue'
import OnboardingCoordinatorHost from '@/features/onboarding/OnboardingCoordinatorHost.vue'
import { chapterForOnboardingEvent } from '@/features/onboarding/onboarding.catalog'
import { createOnboardingCoordinator } from '@/features/onboarding/onboarding.coordinator'
import { onboardingCoordinatorKey } from '@/features/onboarding/onboarding.context'
import { isOnboardingChapterTargetAvailable } from '@/features/onboarding/onboarding.targets'
import { productGuideKey } from '@/features/product-guide/productGuide.context'
import { productGuideDefinitions } from '@/features/product-guide/productGuide.definitions'
import { createDriverJsAdapter } from '@/features/product-guide/productGuide.driver'
import { createProductGuideModule } from '@/features/product-guide/productGuide.module'
import { createVueRouterGuideStepPreparer } from '@/features/product-guide/productGuide.navigation'
import { createProductGuideProgressStorage } from '@/features/product-guide/productGuide.storage'
import { useAuthStore } from '@/stores/auth'
import { detectBrowserFeatures, probeIndexedDB } from '@/utils/browserFeatures'
import '@/features/product-guide/productGuide.css'

const route = useRoute()
const router = useRouter()
const { locale, t } = useI18n()
const auth = useAuthStore()
const userStorage = useUserStorage()
const productGuide = createProductGuideModule({
    getAccountId: () => auth.user?.id ?? null,
    definitions: productGuideDefinitions,
    translate: (key) => String(t(key)),
    storage: createProductGuideProgressStorage({
        getAccountId: () => auth.user?.id ?? null,
        getValue: userStorage.getValue,
        setValue: userStorage.setValue,
    }),
    driver: createDriverJsAdapter(),
    stepPreparer: createVueRouterGuideStepPreparer(router),
})
provide(productGuideKey, { startGuide: productGuide.startGuide })
const onboardingCoordinator = createOnboardingCoordinator({
    runner: productGuide,
    environment: {
        getAccountId: () => auth.user?.id ?? null,
        isPageVisible: () =>
            typeof document !== 'undefined' && document.visibilityState === 'visible',
        hasPageFocus: () =>
            typeof document !== 'undefined' && document.hasFocus(),
        canRunEvent: (event) =>
            typeof document !== 'undefined' &&
            isOnboardingChapterTargetAvailable(
                document,
                chapterForOnboardingEvent(event).chapterId,
            ),
        canReplayChapter: (chapterId) =>
            typeof document !== 'undefined' &&
            isOnboardingChapterTargetAvailable(document, chapterId),
    },
})
provide(onboardingCoordinatorKey, onboardingCoordinator)
const interactionFeedbackCoordinator = createInteractionFeedbackCoordinator()
provide(interactionFeedbackCoordinatorKey, interactionFeedbackCoordinator)
let detachInteractionFeedbackEvents: (() => void) | null = null
const browserSupport = ref<ReturnType<typeof detectBrowserFeatures> | null>(null)
const isBrowserSupported = computed(() => browserSupport.value?.supported ?? true)
const unsupportedFeatures = computed(
    () => browserSupport.value?.unsupportedFeatures ?? [],
)

onMounted(async () => {
    const detected = detectBrowserFeatures()
    browserSupport.value = detected
    if (!detected.supported) return
    if (!(await probeIndexedDB())) {
        browserSupport.value = {
            supported: false,
            features: {
                ...detected.features,
                indexedDB: false,
            },
            unsupportedFeatures: ['indexedDB'],
        }
        return
    }
    void auth.initialize()
    detachInteractionFeedbackEvents = attachInteractionFeedbackBrowserEvents(
        interactionFeedbackCoordinator,
        document,
    )
})
onBeforeUnmount(() => {
    detachInteractionFeedbackEvents?.()
    interactionFeedbackCoordinator.dispose()
})

useHead({
    htmlAttrs: { lang: () => locale.value },
    title: () => `${t(String(route.meta.titleKey ?? 'pages.default'))} - ${t('common.appName')}`,
    meta: [{ name: 'robots', content: 'noindex,nofollow' }],
})
getFrontendRuntime().usePageMetadata()
</script>

<template>
    <UnsupportedBrowserView
        v-if="!isBrowserSupported"
        :unsupported-features="unsupportedFeatures"
    />
    <template v-else>
        <RouterView />
        <ProductGuideHost :account-id="auth.user?.id ?? null" :module="productGuide" />
        <OnboardingCoordinatorHost
            :account-id="auth.user?.id ?? null"
            :runtime="onboardingCoordinator"
        />
    </template>
</template>
