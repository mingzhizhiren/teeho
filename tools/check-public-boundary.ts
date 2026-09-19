import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'

const publicRoot = resolve(import.meta.dir, '..')
const excluded = new Set([
    'node_modules',
    'dist',
    'dist-ssr',
    '.git',
    '.runtime',
    '.tmp',
    '.vite',
    'coverage',
    '__pycache__',
    'test-results',
    'playwright-report',
    '.temp',
    '.branches',
])
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.vue'])
const privateFiles = new Set([
    'server/src/video/video.evaluation.ts',
    'server/src/video/video.codex-evaluation.ts',
    'server/src/utils/orderNo.ts',
])
const privatePaths =
    /^(?:algorithm_train\/|plugins\/official\/|server\/src\/(?:admin|analytics|billing|entitlements|points|refunds|maintenance-recovery)\/|frontend\/src\/features\/(?:admin|analytics|billing|points|refunds)\/)/u
const imports =
    /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|\bexport\s*\*\s*from\s*|\brequire\s*\(\s*)['"]([^'"\r\n]+)['"]/gu

/** 返回可发布文件；构建缓存除外，链接不允许越过公共目录。 */
async function files(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true })
    const groups = await Promise.all(
        entries.map(async (entry): Promise<string[]> => {
            if (excluded.has(entry.name)) return []
            // 本机按模板配置的环境文件已被 Git 忽略，不属于待发布源码。
            if (entry.name.startsWith('.env') && entry.name !== '.env.example') return []
            const path = resolve(directory, entry.name)
            if ((await lstat(path)).isSymbolicLink()) {
                assertContained(await realpath(path), path)
                throw new Error(`发布目录不应包含文件系统链接：${relative(publicRoot, path)}`)
            }
            return entry.isDirectory() ? files(path) : [path]
        }),
    )
    return groups.flat()
}

function assertContained(target: string, source: string): void {
    const local = relative(publicRoot, target)
    if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`)) {
        throw new Error(`公共源码引用仓库外文件：${relative(publicRoot, source)}`)
    }
}

/** 检查源码相对导入、私有模块、凭据及训练包依赖。 */
export async function checkPublicBoundary(): Promise<number> {
    const paths = await files(publicRoot)
    for (const path of paths) {
        const local = relative(publicRoot, path).split(sep).join('/')
        if (privatePaths.test(local) || privateFiles.has(local))
            throw new Error(`公共目录包含私有模块：${local}`)
        if (
            /\.(?:pem|key)$/iu.test(local) ||
            (/(?:^|\/)\.env(?:\.|$)/u.test(local) && !local.endsWith('.env.example'))
        ) {
            throw new Error(`发布目录包含本地凭据文件：${local}`)
        }
        if (!sourceExtensions.has(extname(path)) && !local.endsWith('package.json')) continue
        const source = await readFile(path, 'utf8')
        if (
            /(?:-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|sk-proj-[A-Za-z0-9_-]{30,})/u.test(
                source,
            )
        ) {
            throw new Error(`源码中发现疑似密钥：${local}`)
        }
        if (local.endsWith('package.json')) {
            const manifest = JSON.parse(source) as {
                dependencies?: Record<string, string>
                devDependencies?: Record<string, string>
            }
            if (
                Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).some(
                    (name) => name.startsWith('@teeho/algorithm-train'),
                )
            ) {
                throw new Error(`公共清单依赖私有训练包：${local}`)
            }
        }
        for (const match of source.matchAll(imports)) {
            const specifier = match[1]!
            if (specifier.startsWith('@teeho/algorithm-train'))
                throw new Error(`公共源码依赖私有训练包：${local}`)
            if (specifier.startsWith('.')) assertContained(resolve(dirname(path), specifier), path)
            if (/^(?:[A-Za-z]:[\\/]|file:)/u.test(specifier)) {
                throw new Error(`公共源码包含机器绝对导入：${local}`)
            }
        }
    }
    return paths.length
}

if (import.meta.main) {
    const count = await checkPublicBoundary()
    process.stdout.write(`Public boundary checked: ${count} files\n`)
}
