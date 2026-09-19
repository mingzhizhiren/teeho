import { Elysia } from 'elysia'

import { authenticatedApiPlugin } from '../middleware/auth'
import {
    handleGetNotifications,
    handleReadAllNotifications,
    handleReadNotification,
} from './notification.controller'

/** 统一业务通知 HTTP 路由：`/notifications`。 */
export const notificationRoutes = new Elysia({ prefix: '/notifications' })
    .use(authenticatedApiPlugin)
    .get('', async ({ apiUser, query, set }) => {
        const result = await handleGetNotifications(apiUser.id, query)
        set.status = result.status
        return result.response
    })
    .patch('/read', async ({ apiUser, set }) => {
        const result = await handleReadAllNotifications(apiUser.id)
        set.status = result.status
        return result.response
    })
    .patch('/:notificationId/read', async ({ apiUser, params, set }) => {
        const result = await handleReadNotification(apiUser.id, params.notificationId)
        set.status = result.status
        return result.response
    })
