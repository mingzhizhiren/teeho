import { createHmac, timingSafeEqual } from 'node:crypto'

import { z } from 'zod'

import { workspaceEventConstraints } from './workspace-event.constants'

const tokenPayloadSchema = z
    .object({
        userId: z.string().uuid(),
        expiresAt: z.number().int().positive(),
        nonce: z.string().uuid(),
    })
    .strict()

interface WorkspaceEventTokenOptions {
    secret: string
    now?: Date
}

function sign(payload: string, secret: string) {
    return createHmac('sha256', secret).update(payload).digest('base64url')
}

/** 从已通过 Supabase Auth 的请求签发一分钟 HMAC Bearer 流凭据。 */
export function createWorkspaceEventToken(userId: string, options: WorkspaceEventTokenOptions) {
    const now = options.now ?? new Date()
    const payload = Buffer.from(
        JSON.stringify({
            userId,
            expiresAt: now.getTime() + workspaceEventConstraints.tokenLifetimeMs,
            nonce: crypto.randomUUID(),
        }),
    ).toString('base64url')
    return `v1.${payload}.${sign(payload, options.secret)}`
}

/** 校验流凭据的签名、结构与有效期；失败只返回 null。 */
export function verifyWorkspaceEventToken(token: string, options: WorkspaceEventTokenOptions) {
    try {
        const [version, payload, receivedSignature, extra] = token.split('.')
        if (version !== 'v1' || !payload || !receivedSignature || extra) {
            return null
        }
        const expectedSignature = sign(payload, options.secret)
        const received = Buffer.from(receivedSignature)
        const expected = Buffer.from(expectedSignature)
        if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
            return null
        }
        const parsed = tokenPayloadSchema.parse(
            JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
        )
        if (parsed.expiresAt <= (options.now ?? new Date()).getTime()) {
            return null
        }
        return {
            userId: parsed.userId,
            expiresAt: new Date(parsed.expiresAt).toISOString(),
        }
    } catch {
        return null
    }
}
