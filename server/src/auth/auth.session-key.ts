import { createHash } from 'node:crypto'

import { z } from 'zod'

const authSessionPayloadSchema = z
    .object({ session_id: z.string().uuid().optional() })
    .passthrough()

function readJwtSessionId(accessToken: string): string | null {
    const payload = accessToken.split('.')[1]
    if (!payload) return null
    try {
        const parsed = authSessionPayloadSchema.safeParse(
            JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
        )
        return parsed.success ? (parsed.data.session_id ?? null) : null
    } catch {
        return null
    }
}

/** 已验证 access token 的稳定会话键；不保存 token 本身。 */
export function resolveAuthSessionKey(accessToken: string): string {
    const sessionId = readJwtSessionId(accessToken)
    if (sessionId) return `session:${sessionId}`
    return `token:${createHash('sha256').update(accessToken).digest('hex')}`
}
