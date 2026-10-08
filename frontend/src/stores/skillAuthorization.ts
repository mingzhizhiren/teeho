import { defineStore } from 'pinia'
import { ref } from 'vue'

/** 授权码只在当前应用内存中跨登录页传递，不写入浏览器存储。 */
export const useSkillAuthorizationStore = defineStore('skill-authorization', () => {
    const userCode = ref('')

    function readLink(hash: string): void {
        const codes = new URLSearchParams(hash.slice(1)).getAll('code')
        const code = codes.length === 1 ? codes[0] : ''
        userCode.value = code && /^[a-fA-F0-9]{10}$/u.test(code) ? code.toUpperCase() : ''
    }

    function clear(): void {
        userCode.value = ''
    }

    return { userCode, readLink, clear }
})
