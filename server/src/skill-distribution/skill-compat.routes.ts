import { Elysia } from 'elysia'
import { authenticatedApiPlugin } from '../middleware/auth'
import { ok } from '../utils/response'

/** 已发布 Skill 会先读取该地址；此入口声明无需积分，不提供账户或付费能力。 */
export const skillCompatibilityRoutes = new Elysia({ prefix: '/points' })
    .use(authenticatedApiPlugin)
    .get('/summary', () => ok({ summary: { enabled: false } }))
