import { request, type ApiResponse } from '@/utils/request'
import { z } from 'zod'
const MAX_CURSOR_LENGTH = 128
export interface SkillApproval {
    approved: boolean
    expiresAt: string | null
}
const approvalResponseSchema = z.object({
    approved: z.literal(true),
    expiresAt: z.string().datetime({ offset: true }).nullable(),
})
export interface SkillDevice {
    id: string
    name: string
    createdAt: string
    expiresAt: string | null
}
const devicePageSchema = z.object({
    devices: z.array(
        z.object({
            id: z.string().regex(/^[a-f0-9]{64}$/),
            name: z.string().min(1),
            createdAt: z.string().datetime({ offset: true }),
            expiresAt: z.string().datetime({ offset: true }).nullable(),
        }),
    ),
    nextCursor: z.string().min(1).max(MAX_CURSOR_LENGTH).nullable(),
})
export type SkillDevicePage = z.infer<typeof devicePageSchema>
/** 读取当前账号设备，接口不返回任何授权秘密。 */
export async function listSkillDevices(
    cursor?: string,
    signal?: AbortSignal,
): Promise<SkillDevicePage> {
    const response = await request.get<ApiResponse<unknown>>('/skill/auth/devices', {
        params: cursor ? { cursor } : undefined,
        signal,
    })
    return devicePageSchema.parse(response.data.data)
}
/** 撤销本人设备授权。 */
export async function revokeSkillDevice(id: string, signal?: AbortSignal): Promise<void> {
    await request.post('/skill/auth/revoke', { id }, { signal })
}
/** 由已登录网页批准设备授权，凭据不进入浏览器JS。 */
export async function approveSkillDevice(
    userCode: string,
    remember: boolean,
    signal?: AbortSignal,
): Promise<SkillApproval> {
    const response = await request.post<ApiResponse<unknown>>(
        '/skill/auth/approve',
        {
            userCode,
            remember,
        },
        { signal },
    )
    return approvalResponseSchema.parse(response.data.data)
}
