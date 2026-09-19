import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
    getMe,
    changePassword as requestChangePassword,
    login as requestLogin,
    logout as requestLogout,
    register as requestRegister,
    type AuthLogoutOptions,
    type AuthUser,
} from '@/api/auth'
import { getFrontendRuntime } from '@/edition/runtime'
import { createPasswordChangeSessionFlow } from '@/features/auth/password-change.session'

/** Supabase 认证状态；token 仅存在于 Elysia 设置的 HttpOnly Cookie */
export const useAuthStore = defineStore('auth', () => {
    const user = ref<AuthUser | null>(null)
    const initialized = ref(false)
    const isLoggedIn = computed(() => user.value !== null)
    let initializePromise: Promise<void> | null = null

    /** 初始化当前模块的远端和本地状态 */
    async function initialize() {
        if (initialized.value) {
            return
        }

        if (!initializePromise) {
            initializePromise = (async () => {
                try {
                    const response = await getMe()
                    user.value = response.data.data.user
                } catch {
                    user.value = null
                } finally {
                    initialized.value = true
                }
            })()
        }

        await initializePromise
    }

    /** 调用登录接口并刷新账号状态 */
    async function login(email: string, password: string) {
        await getFrontendRuntime().beforeSessionChange()
        const response = await requestLogin({ email, password })
        user.value = response.data.data.user
        getFrontendRuntime().afterSessionChange()
    }

    /** 调用注册接口并刷新账号状态 */
    async function register(email: string, password: string) {
        await getFrontendRuntime().beforeSessionChange()
        const response = await requestRegister({ email, password })
        const result = response.data.data

        if (!result.requiresEmailConfirmation && result.user) {
            user.value = result.user
            getFrontendRuntime().afterSessionChange()
        }

        return result
    }

    /** 调用退出接口并清空会话状态 */
    async function logout(options: AuthLogoutOptions = {}) {
        await getFrontendRuntime().beforeSessionChange()
        await requestLogout(options)
        getFrontendRuntime().afterSessionChange()
        user.value = null
    }

    /** 修改凭证成功后直接结束本地会话，不再次请求已撤销的远端会话。 */
    async function changePassword(input: {
        currentPassword: string
        newPassword: string
        confirmPassword: string
    }) {
        const flow = createPasswordChangeSessionFlow({
            async requestPasswordChange(password) {
                await requestChangePassword(password)
            },
            endLocalSession() {
                getFrontendRuntime().afterSessionChange()
                user.value = null
            },
        })
        return flow.execute(input)
    }

    return { user, isLoggedIn, initialize, login, register, logout, changePassword }
})
