import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

import { authThrottleConstraints } from './auth-throttle.constants'

const tokenSeparator = '.'

function signTokenId(tokenId: string, secret: string) {
    return createHmac('sha256', secret).update(`auth-device:${tokenId}`).digest('base64url')
}

function createLoginDeviceToken(secret: string) {
    const tokenId = randomBytes(authThrottleConstraints.tokenIdBytes).toString('base64url')
    return `${tokenId}${tokenSeparator}${signTokenId(tokenId, secret)}`
}

/** 验证设备令牌是否由当前服务端签发。 */
export function verifyLoginDeviceToken(token: string, secret: string) {
    const [tokenId, signature, extra] = token.split(tokenSeparator)
    if (!tokenId || !signature || extra !== undefined) return false
    const tokenPartPattern = new RegExp(
        `^[A-Za-z0-9_-]{${authThrottleConstraints.tokenPartBase64UrlLength}}$`,
        'u',
    )
    if (!tokenPartPattern.test(tokenId) || !tokenPartPattern.test(signature)) return false

    const expected = Buffer.from(signTokenId(tokenId, secret), 'base64url')
    const received = Buffer.from(signature, 'base64url')
    return (
        received.length === authThrottleConstraints.tokenSignatureBytes &&
        received.length === expected.length &&
        timingSafeEqual(received, expected)
    )
}

/** 复用有效设备令牌，否则签发新的随机签名令牌。 */
export function resolveLoginDeviceToken(token: string, secret: string) {
    if (verifyLoginDeviceToken(token, secret)) {
        return { token, created: false as const }
    }

    return { token: createLoginDeviceToken(secret), created: true as const }
}
