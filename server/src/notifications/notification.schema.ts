import { z } from 'zod'
import { STABLE_TIME_CURSOR_MAXIMUM_LENGTH } from '../utils/stableTimeCursor'

const maximumNotificationPageSize = 20

/** 分析完成模板及固定工作台导航所需的全部字段。 */
export const analysisCompletedPayloadSchema = z
    .object({
        taskId: z.string().uuid(),
        resultVersion: z.number().int().positive(),
    })
    .strict()

/** 默认只允许分析完成通知，部署方可扩展受控模板。 */
export const businessNotificationContentSchema = z
    .object({ type: z.literal('analysis.completed'), payload: analysisCompletedPayloadSchema })
    .strict()

/** 后端允许持久化的模板类型与结构化载荷联合。 */
export interface BusinessNotificationContent {
    type: string
    payload: Record<string, unknown>
}

/** 返回给当前账号的业务通知记录。 */
export type BusinessNotificationRecord = BusinessNotificationContent & {
    id: string
    createdAt: string
    readAt: string | null
}

/** 业务通知标识只接受 UUID。 */
export const businessNotificationIdSchema = z.string().uuid()

/** 通知列表查询参数；实际游标内容由专用解码器验证。 */
export const notificationListQuerySchema = z
    .object({
        cursor: z.string().max(STABLE_TIME_CURSOR_MAXIMUM_LENGTH).optional(),
        limit: z.coerce
            .number()
            .int()
            .min(1)
            .max(maximumNotificationPageSize)
            .default(maximumNotificationPageSize),
    })
    .strict()
