import { createRouter, type Router, type RouterHistory } from 'vue-router'
import { appRoutePaths } from '@/config/appRoutes'
import { useAuthStore } from '@/stores/auth'
import { resolveSafeRedirect } from '@/utils/redirect'

/** 社区路由只装配诊断、账号和 Agent Skill。 */
export function createAppRouter(
    history: RouterHistory,
    options: { installAuthGuard: boolean },
): Router {
    const router = createRouter({
        history,
        scrollBehavior: (_to, _from, saved) => saved ?? { left: 0, top: 0 },
        routes: [
            { path: '/', redirect: appRoutePaths.workspace },
            {
                path: appRoutePaths.login,
                name: 'login',
                component: () => import('@/pages/Login.vue'),
                meta: { titleKey: 'pages.login', guestOnly: true },
            },
            {
                path: appRoutePaths.register,
                name: 'register',
                component: () => import('@/pages/Register.vue'),
                meta: { titleKey: 'pages.register', guestOnly: true },
            },
            {
                path: appRoutePaths.workspace,
                name: 'workspace',
                component: () => import('@/pages/Workspace.vue'),
                meta: { titleKey: 'pages.workspace', requiresAuth: true },
            },
            {
                path: appRoutePaths.skill,
                name: 'skill-install',
                component: () => import('@/pages/Skill.vue'),
                meta: { titleKey: 'skillInstall.title' },
            },
            {
                path: appRoutePaths.skillDevices,
                name: 'skill-devices',
                component: () => import('@/pages/SkillDevices.vue'),
                meta: { titleKey: 'skillAuth.devices', requiresAuth: true },
            },
            {
                path: appRoutePaths.skillAuthorize,
                name: 'skill-authorize',
                component: () => import('@/pages/SkillAuthorize.vue'),
                meta: { titleKey: 'skillAuth.title', requiresAuth: true },
            },
            {
                path: '/:pathMatch(.*)*',
                name: 'not-found',
                component: () => import('@/pages/NotFound.vue'),
                meta: { titleKey: 'pages.notFound' },
            },
        ],
    })
    if (options.installAuthGuard) {
        router.beforeEach(async (to) => {
            if (!to.meta.requiresAuth && !to.meta.guestOnly) return
            const auth = useAuthStore()
            await auth.initialize()
            if (to.meta.requiresAuth && !auth.isLoggedIn)
                return { path: appRoutePaths.login, query: { redirect: to.fullPath } }
            if (to.meta.guestOnly && auth.isLoggedIn) {
                const target = router.resolve(resolveSafeRedirect(to.query.redirect))
                return target.meta.guestOnly ? appRoutePaths.workspace : target.fullPath
            }
        })
    }
    return router
}
