import { createPinia } from 'pinia'
import { createHead } from '@unhead/vue/client'
import { createApp } from 'vue'
import { createWebHistory } from 'vue-router'
import App from '@/App.vue'
import { initializeTheme } from '@/composables/useTheme'
import { i18n } from '@/locales'
import { createAppRouter } from '@/router'
import { guideAnchorDirective } from '@/features/product-guide/productGuide.anchor'
import '@/assets/styles/main.css'

initializeTheme()
const app = createApp(App)
const router = createAppRouter(createWebHistory(), { installAuthGuard: true })
app.use(createPinia())
app.use(createHead())
app.use(i18n)
app.use(router)
app.directive('guide-anchor', guideAnchorDirective)
void router.isReady().then(() => app.mount('#app'))
