import release from '../../../skills/teeho/release.json'
import { API_CODES } from '../config/constants'
import { fail } from '../utils/response'
import type { ApiResult } from '../utils/response'

export const SKILL_VERSION_HEADER = 'x-teeho-skill-version'
const VERSION_PATTERN = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/

interface SkillVersionInformation {
    readonly minimumVersion: string
    readonly latestVersion: string
    readonly downloadPath: string
}

interface SkillUpgradeInformation extends SkillVersionInformation {
    readonly reason: 'skill_upgrade_required'
}

/** 稳定版本按数字比较；未知或非法版本不能跳过兼容检查。 */
export function isCompatibleSkillVersion(
    version: string | null,
    minimum = release.minimumVersion,
): boolean {
    if (!version || !VERSION_PATTERN.test(version) || !VERSION_PATTERN.test(minimum)) return false
    const current = version.split('.').map(Number)
    const required = minimum.split('.').map(Number)
    const different = current.findIndex((part, index) => part !== required[index])
    return different < 0 || current[different]! > required[different]!
}

/** 路径相对当前 API 地址，避免自部署客户端被引导到另一站点。 */
export function skillVersionInformation(): SkillVersionInformation {
    return {
        minimumVersion: release.minimumVersion,
        latestVersion: release.version,
        downloadPath: '/skill/download',
    }
}

/** 返回统一升级错误；调用者必须在业务副作用之前短路。 */
export function requireCompatibleSkill(
    request: Request,
): ApiResult<SkillUpgradeInformation> | null {
    if (isCompatibleSkillVersion(request.headers.get(SKILL_VERSION_HEADER))) return null
    return fail(
        API_CODES.SKILL_UPGRADE_REQUIRED,
        '题火技能版本过旧或无效，请升级技能后继续；原任务和本机数据会保留。',
        {
            reason: 'skill_upgrade_required',
            ...skillVersionInformation(),
        },
    )
}
