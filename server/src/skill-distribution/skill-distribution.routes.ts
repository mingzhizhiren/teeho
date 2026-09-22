import { Elysia } from 'elysia'
import type { createSkillDistributionController } from './skill-distribution.controller'
import { skillVersionInformation } from './skill-version'
import { ok } from '../utils/response'

/** 无需登录即可取得包含本站配置的 Skill 安装包。 */
export function createSkillDistributionRoutes(
    controller: ReturnType<typeof createSkillDistributionController>,
) {
    return new Elysia({ prefix: '/skill' })
        .get('/version', ({ set }) => {
            set.headers['cache-control'] = 'no-store'
            return ok(skillVersionInformation())
        })
        .get('/download', () => controller.download())
}
