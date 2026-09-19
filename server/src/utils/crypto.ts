import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

import { env } from '../config/env'

const algorithm = 'aes-256-gcm'
// 版本化载荷格式，便于后续升级算法时兼容旧密文
const payloadPrefix = 'teeho:v1:aes-256-gcm'
// GCM 推荐使用 12 字节 IV，每次加密都必须重新随机生成
const ivLength = 12
const bigintOne = 1n
const saltCipherParameters = {
    bitWidth: 64n,
    multiplier: 1_103_515_245n,
    increment: 12_345n,
    outputShift: 32n,
    byteMask: 0xffn,
} as const
const byteMask = 0xff
const base64BlockSize = 4
const uint64Mask = (bigintOne << saltCipherParameters.bitWidth) - bigintOne

/** 校验加密配置密码是否满足最低要求 */
function assertCryptoPassword() {
    if (!env.TEEHO_PWD.trim()) {
        throw new Error('TEEHO_PWD is required for crypto operations')
    }
}

/** 从密码派生对称加密密钥 */
function createKey() {
    assertCryptoPassword()
    // 将统一项目密码稳定派生为 AES-256 所需的 32 字节 key
    return createHash('sha256').update(env.TEEHO_PWD).digest()
}

/** 从密码派生可复现的盐种子 */
function createSaltSeed() {
    // 盐混淆算法使用 64 位数字密码，这里从 AES key 前 8 字节派生
    return createKey().readBigUInt64BE(0)
}

/** 创建基于种子的确定性伪随机生成器 */
function createFakeRandomGenerator(numberPwd: bigint) {
    let currentNumberPwd = numberPwd & uint64Mask

    return () => {
        // 保持与 C++ 版本一致的 uint64 溢出语义
        currentNumberPwd =
            (currentNumberPwd * saltCipherParameters.multiplier + saltCipherParameters.increment) &
            uint64Mask
        return Number(
            (currentNumberPwd >> saltCipherParameters.outputShift) & saltCipherParameters.byteMask,
        )
    }
}

/** 使用确定性盐封装加密或解密操作 */
function applySaltCrypto(data: Buffer, numberPwd = createSaltSeed()) {
    if (data.length === 0) {
        return data
    }

    const randGen = createFakeRandomGenerator(numberPwd)

    for (let index = 0; index < data.length; index += 1) {
        // 该字节变换是自反的：同一密码流再次执行即可还原原文
        const salt = randGen()
        data[index] = (data[index] + salt) & byteMask
        data[index] = ~data[index] & byteMask
        data[index] ^= randGen()
        data[index] = (data[index] - salt) & byteMask
    }

    return data
}

/** 把字节编码为 URL 安全的 Base64 文本 */
function encodeBase64Url(buffer: Buffer) {
    return buffer.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/** 把 URL 安全的 Base64 文本解码为字节 */
function decodeBase64Url(value: string) {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
    const paddingLength =
        (base64BlockSize - (normalized.length % base64BlockSize)) % base64BlockSize
    return Buffer.from(normalized + '='.repeat(paddingLength), 'base64')
}

/** AES-256-GCM 加密字符串；`isSalt` 为 true 时先做盐混淆 */
export function encryptText(plaintext: string, isSalt = true) {
    const iv = randomBytes(ivLength)
    const cipher = createCipheriv(algorithm, createKey(), iv)
    const plaintextBuffer = Buffer.from(plaintext, 'utf8')
    const inputBuffer = isSalt ? applySaltCrypto(plaintextBuffer) : plaintextBuffer
    const ciphertext = Buffer.concat([cipher.update(inputBuffer), cipher.final()])
    const tag = cipher.getAuthTag()

    return [
        payloadPrefix,
        encodeBase64Url(iv),
        encodeBase64Url(tag),
        encodeBase64Url(ciphertext),
    ].join(':')
}

/** 解密文本；isSalt 必须与加密时保持一致 */
export function decryptText(payload: string, isSalt = true) {
    const [namespace, version, payloadAlgorithm, ivValue, tagValue, ciphertextValue] =
        payload.split(':')

    if (`${namespace}:${version}:${payloadAlgorithm}` !== payloadPrefix) {
        throw new Error('Unsupported encrypted payload format')
    }

    if (!ivValue || !tagValue || !ciphertextValue) {
        throw new Error('Invalid encrypted payload')
    }

    const decipher = createDecipheriv(algorithm, createKey(), decodeBase64Url(ivValue))
    decipher.setAuthTag(decodeBase64Url(tagValue))

    const plaintextBuffer = Buffer.concat([
        decipher.update(decodeBase64Url(ciphertextValue)),
        decipher.final(),
    ])
    const outputBuffer = isSalt ? applySaltCrypto(plaintextBuffer) : plaintextBuffer

    return outputBuffer.toString('utf8')
}

/** 将值 JSON 序列化后经 `encryptText` 加密 */
export function encryptJson<T>(value: T, isSalt = true) {
    return encryptText(JSON.stringify(value), isSalt)
}

/** `encryptJson` 的逆操作；调用方通过泛型断言期望结构 */
export function decryptJson<T>(payload: string, isSalt = true) {
    return JSON.parse(decryptText(payload, isSalt)) as T
}
