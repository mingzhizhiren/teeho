import { sql } from 'drizzle-orm'

import { db, type DatabaseExecutor } from '../db/database'
import { encodeNotificationCursor, type NotificationCursorPosition } from './notification.cursor'
import {
    businessNotificationContentSchema,
    type BusinessNotificationRecord,
    type BusinessNotificationContent,
} from './notification.schema'

interface BusinessNotificationRow extends Record<string, unknown> {
    id: string
    type: string
    payload: unknown
    createdAt: Date | string
    readAt: Date | string | null
}

/** 把数据库时间统一转换为 API 使用的 ISO 字符串。 */
function toIsoString(value: Date | string) {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

/** 数据库约束之外再次校验受控通知类型和结构化载荷。 */
function mapBusinessNotification(row: BusinessNotificationRow): BusinessNotificationRecord {
    const content = parseNotificationContent({
        type: row.type,
        payload: row.payload,
    })
    return {
        id: row.id,
        ...content,
        createdAt: toIsoString(row.createdAt),
        readAt: row.readAt ? toIsoString(row.readAt) : null,
    }
}

/** 在分析成功事务内创建受控业务通知；账号和稳定去重键共同保证幂等。 */
export async function createAnalysisCompletedNotification(
    executor: DatabaseExecutor,
    userId: string,
    taskId: string,
    resultVersion: number,
) {
    await executor.execute(sql`
        INSERT INTO public.business_notifications (
            user_id,
            type,
            payload,
            analysis_task_id,
            analysis_result_version,
            deduplication_key
        )
        VALUES (
            ${userId}::uuid,
            'analysis.completed',
            jsonb_build_object(
                'taskId', ${taskId}::uuid::text,
                'resultVersion', ${resultVersion}::smallint
            ),
            ${taskId}::uuid,
            ${resultVersion}::smallint,
            'analysis:' || ${taskId}::uuid::text || ':result:' || ${resultVersion}::text
        )
        ON CONFLICT (user_id, deduplication_key)
        DO NOTHING
    `)
}

/** 读取当前账号最近的受控业务通知。 */
export async function findNotificationPage(
    userId: string,
    options: { limit: number; cursor: NotificationCursorPosition | null },
    executor: DatabaseExecutor = db,
) {
    const cursorCondition = options.cursor
        ? sql`AND (created_at, id) < (
              ${options.cursor.createdAt}::timestamptz,
              ${options.cursor.id}::uuid
          )`
        : sql``
    const queryLimit = options.limit + 1
    const rows = await executor.execute<BusinessNotificationRow>(sql`
        SELECT
            id::text AS id,
            type,
            payload,
            created_at AS "createdAt",
            read_at AS "readAt"
        FROM public.business_notifications
        WHERE user_id = ${userId}::uuid
            ${cursorCondition}
        ORDER BY created_at DESC, id DESC
        LIMIT ${queryLimit}
    `)
    const notifications = rows.slice(0, options.limit).map(mapBusinessNotification)
    const lastNotification = notifications.at(-1)
    return {
        notifications,
        nextCursor:
            rows.length > options.limit && lastNotification
                ? encodeNotificationCursor({
                      createdAt: lastNotification.createdAt,
                      id: lastNotification.id,
                  })
                : null,
    }
}

/** 统计当前账号全部未读通知，而不是当前页内未读数。 */
export async function countUnreadNotifications(userId: string, executor: DatabaseExecutor = db) {
    const rows = await executor.execute<{ count: number | string }>(sql`
        SELECT count(*)::int AS count
        FROM public.business_notifications
        WHERE user_id = ${userId}::uuid
            AND read_at IS NULL
    `)
    return Number(rows[0]?.count ?? 0)
}

/** 幂等标记当前账号自己的单条业务通知为已读。 */
export async function readNotification(
    userId: string,
    notificationId: string,
    executor: DatabaseExecutor = db,
) {
    const rows = await executor.execute<BusinessNotificationRow>(sql`
        UPDATE public.business_notifications
        SET read_at = COALESCE(read_at, now())
        WHERE id = ${notificationId}::uuid
            AND user_id = ${userId}::uuid
        RETURNING
            id::text AS id,
            type,
            payload,
            created_at AS "createdAt",
            read_at AS "readAt"
    `)
    return rows[0] ? mapBusinessNotification(rows[0]) : null
}

/** 标记当前账号全部未读业务通知，不受客户端当前列表范围影响。 */
export async function readAllNotifications(userId: string, executor: DatabaseExecutor = db) {
    const rows = await executor.execute<{ id: string }>(sql`
        UPDATE public.business_notifications
        SET read_at = now()
        WHERE user_id = ${userId}::uuid
            AND read_at IS NULL
        RETURNING id::text AS id
    `)
    return rows.length
}
let parseNotificationContent: (input: unknown) => BusinessNotificationContent = (input) =>
    businessNotificationContentSchema.parse(input)
/** 部署入口注册额外通知模板，公共默认仅接受分析完成通知。 */
export function configureNotificationParser(
    parser: (input: unknown) => BusinessNotificationContent,
): void {
    parseNotificationContent = parser
}
