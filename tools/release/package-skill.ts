import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { findPythonExecutable } from './python-runtime'
import release from '../../skills/teeho/release.json'
import { isCompatibleSkillVersion } from '../../server/src/skill-distribution/skill-version'
import { assertSkillSource } from './package-skill-source'
const root = resolve(import.meta.dirname, '../..')
const skillRoot = resolve(root, 'skills/teeho')

/** 递归收集 Python 源文件，忽略链接、测试和运行生成的缓存。 */
async function collectPythonTools(directory: string): Promise<string[]> {
    const entries = await readdir(join(skillRoot, directory), { withFileTypes: true })
    const groups = await Promise.all(
        entries.map(async (entry): Promise<string[]> => {
            if (entry.name === '__pycache__' || entry.name === 'tests') return []
            const path = `${directory}/${entry.name}`
            if (entry.isDirectory()) return collectPythonTools(path)
            return entry.isFile() && entry.name.endsWith('.py') && !entry.name.startsWith('test_')
                ? [path]
                : []
        }),
    )
    return groups.flat().sort()
}

type SkillEntry = readonly [path: string, content: Buffer]
type SkillArchiveLayout = 'directory' | 'contents'
const SKILL_DIRECTORY_PREFIX = 'teeho/'

/** 收集发布包与公开源码目录共用的完整 Skill 文件。 */
export async function collectSkillEntries(source = 'github'): Promise<SkillEntry[]> {
    assertSkillSource(source)
    const toolFiles = await collectPythonTools('tools')
    for (const required of ['tools/teeho.py', 'tools/teeho_skill/__init__.py']) {
        if (!toolFiles.includes(required)) throw new Error(`Missing Python skill file: ${required}`)
    }
    const names = [
        'SKILL.md',
        'README.md',
        'LICENSE.md',
        'endpoint.json',
        'release.json',
        'references/inspiration.md',
        'references/uninstall.md',
        ...toolFiles,
    ]
    const toolEntries = await Promise.all(
        names.map(
            async (name) =>
                [SKILL_DIRECTORY_PREFIX + name, await readFile(join(skillRoot, name))] as const,
        ),
    )
    return toolEntries.map(([path, content]) => [
        path,
        path === 'teeho/tools/teeho_skill/distribution.py'
            ? Buffer.from(`"""发布渠道的内部构建标记。"""\n\nSOURCE = '${source}'\n`)
            : content,
    ])
}

/** 打包公开技能资料；默认保留安装器所需目录，渠道上传可只打包目录内容。 */
export async function packageSkill(
    output: string,
    source = 'github',
    layout: SkillArchiveLayout = 'directory',
): Promise<string> {
    const skillMarkdown = await readFile(join(skillRoot, 'SKILL.md'), 'utf8')
    const frontmatter = skillMarkdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1]
    const version = frontmatter?.match(
        /^metadata:\r?\n[ \t]+version: (["'])(\d+\.\d+(?:\.\d+)?(?:-[\w.-]+)?)\1\s*$/m,
    )?.[2]
    if (!version) {
        throw new Error('Skill version metadata is missing or invalid')
    }
    if (version !== release.version)
        throw new Error('Skill metadata and release.json versions differ')
    if (!isCompatibleSkillVersion(release.version, release.minimumVersion))
        throw new Error('Skill release must meet its minimum compatible version')
    const entries = await collectSkillEntries(source)
    await mkdir(dirname(resolve(output)), { recursive: true })
    const child = Bun.spawn(
        [
            findPythonExecutable(),
            '-B',
            '-S',
            '-X',
            'utf8',
            resolve(root, 'tools/release/package-skill.py'),
            resolve(output),
        ],
        { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
    )
    child.stdin.write(
        JSON.stringify(
            Object.fromEntries(
                entries.map(([name, bytes]) => [
                    layout === 'contents' ? name.slice(SKILL_DIRECTORY_PREFIX.length) : name,
                    bytes.toString('base64'),
                ]),
            ),
        ),
    )
    child.stdin.end()
    const [exitCode, error] = await Promise.all([child.exited, new Response(child.stderr).text()])
    if (exitCode !== 0) throw new Error(`Skill ZIP packaging failed: ${error}`)
    return version
}
/** 为指定站点生成同一份技能包；公共源码始终取自本仓库。 */
export async function buildSkillAssets(siteRoot = resolve(root, 'frontend')): Promise<void> {
    const version = await packageSkill(
        resolve(siteRoot, 'public/downloads/teeho-skill.zip'),
        'official',
    )
    await rm(resolve(siteRoot, 'public/downloads/teeho-skill.tgz'), { force: true })
    await Bun.write(
        resolve(siteRoot, 'src/config/skill-release.generated.json'),
        JSON.stringify({ version }, null, 4) + '\n',
    )
    const instructionPath = resolve(root, 'docs/skill-install.md')
    const instructions = await readFile(instructionPath, 'utf8')
    const releaseBlock = `<!-- skill-version:start -->\n当前发布版本：**${version}**。\n网站／本地下载：[题火技能包](/api/skill/download)。\nGitHub 下载：[题火技能包](https://github.com/mingzhizhiren/teeho/releases/download/v${version}/teeho-agent-skill.zip)。\n按下方渠道规则选择下载地址，安装或升级以本文版本和实际包内容为准。\n<!-- skill-version:end -->`
    const published = instructions.includes('<!-- skill-version:start -->')
        ? instructions.replace(
              /<!-- skill-version:start -->[\s\S]*?<!-- skill-version:end -->/,
              releaseBlock,
          )
        : instructions.replace(/^(# [^\r\n]+)\r?\n/, `$1\n\n${releaseBlock}\n`)
    await Bun.write(instructionPath, published)
    await Bun.write(resolve(siteRoot, 'public/skill-install.md'), published)
    process.stdout.write('Skill package ready\n')
}
if (import.meta.main) await buildSkillAssets()
