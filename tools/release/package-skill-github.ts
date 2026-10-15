import { resolve } from 'node:path'
import { packageSkill } from './package-skill'

/** 生成 GitHub Release 使用的技能包，不复用官网渠道包。 */
export async function buildGithubSkillAsset(
    output = resolve(import.meta.dir, '../../artifacts/teeho-agent-skill.zip'),
): Promise<void> {
    await packageSkill(output, 'github')
}

if (import.meta.main) {
    await buildGithubSkillAsset()
    process.stdout.write('GitHub skill package ready in artifacts/teeho-agent-skill.zip\n')
}
