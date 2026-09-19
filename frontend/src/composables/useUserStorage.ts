import { computed } from 'vue'
import type { ZodType } from 'zod'
import { IndexedDbFileManager } from '@/utils/indexedDbFiles'
import {
    clearUserLocalValues,
    getUserLocalValue,
    removeUserLocalValue,
    setUserLocalValue,
} from '@/utils/userLocalStorage'
import { useAuthStore } from '@/stores/auth'

const fileManagers = new Map<string, IndexedDbFileManager>()

/** 复用当前用户对应的 IndexedDB 文件管理器 */
function getFileManager(userId: string) {
    const existingManager = fileManagers.get(userId)
    if (existingManager) {
        return existingManager
    }

    const manager = new IndexedDbFileManager(userId)
    fileManagers.set(userId, manager)
    return manager
}

/** 当前登录账号的加密 localStorage 与 IndexedDB 入口 */
export function useUserStorage() {
    const auth = useAuthStore()

    /** 读取并校验当前登录用户 ID */
    function requireUserId() {
        if (!auth.user?.id) {
            throw new Error('用户未登录，无法访问账号本地存储')
        }

        return auth.user.id
    }

    const files = computed(() => (auth.user?.id ? getFileManager(auth.user.id) : null))

    return {
        files,
        getValue: <T>(key: string, schema: ZodType<T>) =>
            getUserLocalValue(requireUserId(), key, schema),
        setValue: <T>(key: string, value: T) =>
            setUserLocalValue(requireUserId(), key, value),
        removeValue: (key: string) => removeUserLocalValue(requireUserId(), key),
        clearValues: () => clearUserLocalValues(requireUserId()),
        clearAll: async () => {
            const userId = requireUserId()
            const fileManager = getFileManager(userId)
            await clearUserLocalValues(userId)
            await fileManager.clearRecords()
            await fileManager.clearFiles()
        },
    }
}
