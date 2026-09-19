/** 结束当前会话时可由后端顺带登记的清理意图。 */
export interface AccountLogoutOptions {
    readonly cleanupCloudAssets?: boolean
}

/** 账号退出与数据清理流程依赖的会话适配器。 */
export interface AccountSessionAdapter {
    logout: (options?: AccountLogoutOptions) => Promise<unknown>
    clearCurrentUserData: () => Promise<unknown>
    cleanupCurrentUserAssets: () => Promise<unknown>
    navigateHome: () => Promise<unknown>
    refreshWorkspace: () => Promise<unknown>
    beforeLogout?: () => void
    beforeWorkspaceReset?: () => void
}

type AccountSignOutAdapter = Pick<
    AccountSessionAdapter,
    'logout' | 'navigateHome' | 'beforeLogout'
>

/** 结束当前登录会话，但保留当前用户的本地加密数据。 */
export async function signOutAccountSession(adapter: AccountSignOutAdapter) {
    try {
        await adapter.logout()
    } catch {
        return { kind: 'logout_failed' as const }
    }
    adapter.beforeLogout?.()
    await adapter.navigateHome()
    return { kind: 'signed_out' as const }
}

/** 隐藏账号退出与当前用户本地/云端临时数据清理的顺序和失败语义。 */
export function createAccountSessionFlow(adapter: AccountSessionAdapter) {
    return {
        /**
         * 结束当前登录会话，但保留当前用户的本地加密数据。
         */
        signOut: () => signOutAccountSession(adapter),

        /**
         * 清理当前用户的本地数据，再由注销请求异步登记云端清理意图。
         */
        async clearCurrentUserDataAndSignOut() {
            try {
                await adapter.clearCurrentUserData()
            } catch {
                return { kind: 'local_data_failed' as const }
            }

            try {
                await adapter.logout({ cleanupCloudAssets: true })
            } catch {
                return { kind: 'logout_failed' as const }
            }
            adapter.beforeLogout?.()
            await adapter.navigateHome()
            return { kind: 'signed_out' as const }
        },

        /**
         * 不等待云端清理响应，立即清理当前账号的本地数据并刷新工作区。
         */
        async clearCurrentUserDataWithoutSignOut() {
            void adapter.cleanupCurrentUserAssets().catch(() => undefined)
            try {
                await adapter.clearCurrentUserData()
            } catch {
                return { kind: 'local_data_failed' as const }
            }
            adapter.beforeWorkspaceReset?.()
            await adapter.refreshWorkspace()
            return { kind: 'local_data_cleared' as const }
        },
    }
}
