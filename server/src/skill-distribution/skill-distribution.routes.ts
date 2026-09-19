import { Elysia } from 'elysia'
import type { createSkillDistributionController } from './skill-distribution.controller'

/** 无需登录即可取得包含本站配置的 Skill 安装包。 */
export function createSkillDistributionRoutes(
    controller: ReturnType<typeof createSkillDistributionController>,
) {
    return new Elysia({ prefix: '/skill' }).get('/download', () => controller.download())
}
