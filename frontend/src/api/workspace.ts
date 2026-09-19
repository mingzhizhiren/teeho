import { z } from 'zod'

import { request, type ApiResponse } from '@/utils/request'

const workspaceEventTokenDataSchema = z.object({
    token: z.string().min(1),
    expiresAt: z.string().datetime({ offset: true }),
})

/** 通过 HttpOnly Supabase 会话取得一分钟 Bearer 流凭据。 */
export async function createWorkspaceEventToken() {
    const response = await request.post<ApiResponse<unknown>>('/workspace/events/token')
    return workspaceEventTokenDataSchema.parse(response.data.data).token
}
