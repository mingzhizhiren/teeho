import { z } from 'zod'

const userCryptoConstraints = {
    contextMaxLength: 500,
    hexadecimalRadix: 16,
    hexadecimalByteWidth: 2,
    initializationVectorBytes: 12,
} as const

const encryptionSeedSchema = z.string().min(1)
const userIdSchema = z.string().min(1)
const encryptionContextSchema = z
    .string()
    .min(1)
    .max(userCryptoConstraints.contextMaxLength)
const encryptedTextSchema = z.object({
    version: z.literal(1),
    iv: z.string().min(1),
    ciphertext: z.string().min(1),
})

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
const encryptionIterations = 120_000

/** AES-GCM 二进制密文；IV 必须与密文一起保存 */
export interface EncryptedBinary {
    version: 1
    iv: ArrayBuffer
    ciphertext: ArrayBuffer
}

/** 把二进制内容编码为 Base64 */
function bytesToBase64(value: ArrayBuffer) {
    const bytes = new Uint8Array(value)
    let binary = ''
    const chunkSize = 0x8000

    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
    }

    return window.btoa(binary)
}

/** 把 Base64 文本解码为二进制内容 */
function base64ToArrayBuffer(value: string) {
    const binary = window.atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
    }
    return bytes.buffer
}

/** 使用公开种子和用户 ID 派生每账号不同的 AES-GCM 密钥 */
export class UserEncryption {
    private readonly seed: string
    private readonly keyPromises = new Map<string, Promise<CryptoKey>>()

    /**
     * 创建使用稳定公开种子派生用户级加密密钥的加密器。
     * @param seed 浏览器端用户数据加密种子
     */
    constructor(seed: string) {
        this.seed = encryptionSeedSchema.parse(seed)
    }

    /** 取得或派生指定用户的 AES-GCM 密钥 */
    private getKey(userId: string) {
        const validUserId = userIdSchema.parse(userId)
        const cachedKey = this.keyPromises.get(validUserId)
        if (cachedKey) {
            return cachedKey
        }

        const keyPromise = crypto.subtle
            .importKey('raw', textEncoder.encode(this.seed), 'PBKDF2', false, ['deriveKey'])
            .then((keyMaterial) =>
                crypto.subtle.deriveKey(
                    {
                        name: 'PBKDF2',
                        salt: textEncoder.encode(`teeho:user-storage:v1:${validUserId}`),
                        iterations: encryptionIterations,
                        hash: 'SHA-256',
                    },
                    keyMaterial,
                    { name: 'AES-GCM', length: 256 },
                    false,
                    ['encrypt', 'decrypt'],
                ),
            )

        this.keyPromises.set(validUserId, keyPromise)
        return keyPromise
    }

    /** 生成不暴露原始用户 ID 的稳定存储分区标识 */
    async getUserScope(userId: string) {
        const validUserId = userIdSchema.parse(userId)
        const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(validUserId))
        return Array.from(new Uint8Array(digest), (byte) =>
            byte
                .toString(userCryptoConstraints.hexadecimalRadix)
                .padStart(userCryptoConstraints.hexadecimalByteWidth, '0'),
        ).join('')
    }

    /** 加密二进制数据；context 用于阻止不同存储项之间互换密文 */
    async encrypt(userId: string, value: ArrayBuffer, context: string): Promise<EncryptedBinary> {
        const validContext = encryptionContextSchema.parse(context)
        const key = await this.getKey(userId)
        const iv = crypto.getRandomValues(
            new Uint8Array(userCryptoConstraints.initializationVectorBytes),
        )
        const ciphertext = await crypto.subtle.encrypt(
            {
                name: 'AES-GCM',
                iv,
                additionalData: textEncoder.encode(validContext),
            },
            key,
            value,
        )

        return {
            version: 1,
            iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength),
            ciphertext,
        }
    }

    /** 解密二进制数据；用户、context 或密文不匹配时会失败 */
    async decrypt(userId: string, value: EncryptedBinary, context: string) {
        const validContext = encryptionContextSchema.parse(context)
        const key = await this.getKey(userId)
        return crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: value.iv,
                additionalData: textEncoder.encode(validContext),
            },
            key,
            value.ciphertext,
        )
    }

    /** 加密文本并序列化为可写入 localStorage 的字符串 */
    async encryptText(userId: string, value: string, context: string) {
        const encrypted = await this.encrypt(userId, textEncoder.encode(value).buffer, context)
        return JSON.stringify({
            version: encrypted.version,
            iv: bytesToBase64(encrypted.iv),
            ciphertext: bytesToBase64(encrypted.ciphertext),
        })
    }

    /** 解析并解密 localStorage 中的文本密文 */
    async decryptText(userId: string, value: string, context: string) {
        const parsed = encryptedTextSchema.parse(JSON.parse(value) as unknown)
        const decrypted = await this.decrypt(
            userId,
            {
                version: parsed.version,
                iv: base64ToArrayBuffer(parsed.iv),
                ciphertext: base64ToArrayBuffer(parsed.ciphertext),
            },
            context,
        )
        return textDecoder.decode(decrypted)
    }
}

let userEncryption: UserEncryption | null = null

/** 获取由 Vite 公开配置初始化的用户数据加密器 */
export function getUserEncryption() {
    if (!userEncryption) {
        userEncryption = new UserEncryption(import.meta.env.VITE_TEEHO_PWD)
    }

    return userEncryption
}
