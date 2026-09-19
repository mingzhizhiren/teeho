import { z, type ZodType } from 'zod'
import { supportsLocalStorage } from '@/utils/browserFeatures'
import { getUserEncryption } from '@/utils/userCrypto'

const userStorageKeySchema = z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/)
const userStoragePrefix = 'teeho.user.v1'

/** 生成当前用户隔离的本地存储键 */
async function createStorageKey(userId: string, key: string) {
    const validKey = userStorageKeySchema.parse(key)
    const userScope = await getUserEncryption().getUserScope(userId)
    return `${userStoragePrefix}.${userScope}.${validKey}`
}

/** 加密并保存当前账号的 JSON 数据 */
export async function setUserLocalValue<T>(userId: string, key: string, value: T) {
    if (!supportsLocalStorage()) {
        throw new Error('当前浏览器不支持 localStorage')
    }

    const storageKey = await createStorageKey(userId, key)
    const serializedValue = JSON.stringify(value)
    if (serializedValue === undefined) {
        throw new TypeError('用户本地数据必须可以序列化为 JSON')
    }

    const encrypted = await getUserEncryption().encryptText(
        userId,
        serializedValue,
        `localStorage:${storageKey}`,
    )
    window.localStorage.setItem(storageKey, encrypted)
}

/** 读取、解密并校验当前账号的 JSON 数据；不存在时返回 null */
export async function getUserLocalValue<T>(userId: string, key: string, schema: ZodType<T>) {
    if (!supportsLocalStorage()) {
        throw new Error('当前浏览器不支持 localStorage')
    }

    const storageKey = await createStorageKey(userId, key)
    const encrypted = window.localStorage.getItem(storageKey)
    if (encrypted === null) {
        return null
    }

    const decrypted = await getUserEncryption().decryptText(
        userId,
        encrypted,
        `localStorage:${storageKey}`,
    )
    return schema.parse(JSON.parse(decrypted) as unknown)
}

/** 删除当前账号的一项本地数据 */
export async function removeUserLocalValue(userId: string, key: string) {
    if (!supportsLocalStorage()) {
        return
    }

    window.localStorage.removeItem(await createStorageKey(userId, key))
}

/** 只清理当前账号的全部加密 localStorage 数据 */
export async function clearUserLocalValues(userId: string) {
    if (!supportsLocalStorage()) {
        return
    }

    const userScope = await getUserEncryption().getUserScope(userId)
    const prefix = `${userStoragePrefix}.${userScope}.`
    const keysToRemove: string[] = []

    for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index)
        if (key?.startsWith(prefix)) {
            keysToRemove.push(key)
        }
    }

    keysToRemove.forEach((key) => window.localStorage.removeItem(key))
}
