import { cp, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const isRelease = process.argv.includes('--release')
const debugEnabled =
    !isRelease && process.env.NODE_ENV !== 'production' && process.env.DEBUG === 'true'

const result = await Bun.build({
    entrypoints: ['./src/app.ts', './src/video/video.worker-entry.ts'],
    outdir: './dist',
    target: 'bun',
    format: 'esm',
    external: ['pino'],
    minify: isRelease,
    sourcemap: isRelease ? 'none' : 'linked',
    define: {
        DEBUG: JSON.stringify(debugEnabled),
    },
})

if (!result.success) {
    for (const log of result.logs) {
        console.error(log)
    }

    process.exit(1)
}

console.log(`Built API and video worker bundles with DEBUG=${debugEnabled}`)

// 删除仅限已核对的插件构建输出，避免公共构建残留私有产物。
const pluginOutput = resolve('./dist/plugins')
if (pluginOutput !== resolve(process.cwd(), 'dist', 'plugins'))
    throw new Error('Invalid plugin output')
await rm(pluginOutput, { recursive: true, force: true })
for (const name of ['example']) {
    const output = await Bun.build({
        entrypoints: [`../plugins/${name}/config.ts`],
        outdir: `./dist/plugins/${name}`,
        target: 'bun',
        format: 'esm',
        external: ['pino'],
        minify: isRelease,
        define: { DEBUG: JSON.stringify(debugEnabled) },
    })
    if (!output.success) throw new Error(`Plugin bundle failed: ${name}: ${output.logs.join('\n')}`)
}
await mkdir('./dist/plugins/example/data', { recursive: true })
await cp('../plugins/example/data/notes.json', './dist/plugins/example/data/notes.json')
